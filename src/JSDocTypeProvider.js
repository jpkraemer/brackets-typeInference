/*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, maxerr: 50 */
/*global define, $, brackets, Mustache */

/** 
 * Triggers: 
 * didReceiveTypeInformation - Triggered whenever new method arguments were collected. 
 */

 define(function (require, exports, module) {
 	"use strict"; 

 	var _ 								= require("./lib/lodash");
 	var DocumentManager 				= brackets.getModule("document/DocumentManager");
 	var Commands            			= brackets.getModule("command/Commands");
 	var CommandManager			 		= brackets.getModule("command/CommandManager");
 	var FunctionTracker					= require("./FunctionTracker");
 	var JSUtils 						= brackets.getModule("language/JSUtils");
 	var TypeInformationJSDocRenderer 	= require("./TypeInformationJSDocRenderer");

 	var EVENT_NAMESPACE = ".JSDocTypeProvider";

 	var currentDocument;

 	function init () {
 		$(DocumentManager).on("currentDocumentChange" + EVENT_NAMESPACE, _didChangeCurrentDocument);
 		_setCurrentDocument(DocumentManager.getCurrentDocument()); 

 		$(FunctionTracker).on("didUpdateTrackedFunctions" + EVENT_NAMESPACE, _didUpdateTrackedFunctions);
 	}

 	function _didChangeCurrentDocument (event, newDocument, oldDocument) {
 		_setCurrentDocument(newDocument);
 	}

 	function _setCurrentDocument (newDocument) {
 		currentDocument = newDocument;
 		// _addFunctionIdentifiersInDocument(currentDocument);
 		// _parseInformationFromDocument(currentDocument);
 	}

 	function _didUpdateTrackedFunctions (event, indexedFunctions, unindexedFunctions, changes) {
 		//don't listen to change events while performing changes ourselves
 		$(FunctionTracker).off(EVENT_NAMESPACE);
 		_addFunctionIdentifiersInDocument(currentDocument, unindexedFunctions);
 		$(FunctionTracker).on("didUpdateTrackedFunctions" + EVENT_NAMESPACE, _didUpdateTrackedFunctions);
 		_parseInformationFromDocument(currentDocument, indexedFunctions);
 	}

	/**
	 * Iterates through all the functions and adds unique identifiers to the jsdoc source. These can then be used by fondue and other parsers.
	 * @param {Document} document
 	 * @param {[Function Location]} unindexedFunctions
	 */
	function _addFunctionIdentifiersInDocument (document, unindexedFunctions) {
		var documentWasDirty = document.isDirty;

		//since notifications from the function tracker are turned off while in this function, we need to register the functions in 
		//the type information store from here
		var results = []; 

		for (var i = 0; i < unindexedFunctions.length; i++) {
			var functionInfo = unindexedFunctions[i]; 
			var functionName = functionInfo.name || "anonymous";
			var functionIdentifier = document.file.fullPath + "-function-" + functionName + "-" + Math.random().toString(36).substr(2,5);
			var functionIdentifierJSDoc = " * " + TypeInformationJSDocRenderer.functionIdentifierToJSDoc(functionIdentifier) + "\n";
			var commentInset; 
			if (functionInfo.commentRange !== undefined) {
				var commentText = document.getRange(functionInfo.commentRange.start, functionInfo.commentRange.end);
				var commentAsTypeInformation = TypeInformationJSDocRenderer.updateTypeInformationWithJSDoc({}, commentText);
				commentInset = document.getRange({ line: functionInfo.commentRange.start.line, ch: 0 }, functionInfo.commentRange.start);
				document.replaceRange(commentInset + functionIdentifierJSDoc, { line: functionInfo.commentRange.end.line, ch: 0 });
			} else {
				commentInset = document.getRange({ line: functionInfo.functionRange.start.line, ch: 0 }, functionInfo.functionRange.start);
				var newCommentText = "\n" + commentInset + "/**\n" + commentInset + functionIdentifierJSDoc + commentInset + " */";
				document.replaceRange(newCommentText, functionInfo.functionRange.start);
			}
			results.push({
				file: document.file.fullPath,
				functionIdentifier: functionIdentifier
			});
		}

		if (! documentWasDirty) {
			CommandManager.execute(Commands.FILE_SAVE, document);
		}

		$(exports).trigger("didReceiveTypeInformation", [ results ]);
	}

	/**
	 * Iterates through the comment blocks and extracts JSDoc type information
	 * @param  {Document} document
	 * @param  {Object with function Ids -> functionLocations} indexedFunctions
	 */
	function _parseInformationFromDocument (document, indexedFunctions) {
		var results = [];

		_.forOwn(indexedFunctions, function (functionLocation, functionIdentifier) {
			var commentText = document.getRange(functionLocation.commentRange.start, functionLocation.commentRange.end);
			commentText = commentText.replace(/^\s*(?:\*\/?|\/\*\*)/mg, "");
			var typeInformation = TypeInformationJSDocRenderer.updateTypeInformationWithJSDoc({ file: document.file.fullPath }, commentText);
			results.push(typeInformation);
		});
		
		$(exports).trigger("didReceiveTypeInformation", [ results ]); 
	}

	exports.init = init; 
});