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
 	var TIUtils 						= require("./TIUtils");
 	var TypeInformationJSDocRenderer 	= require("./TypeInformationJSDocRenderer");
 	var TypeInformationStore			= require("./TypeInformationStore");

 	var EVENT_NAMESPACE = ".JSDocTypeProvider";

 	var currentDocument;

 	function init () {
 		$(DocumentManager).on("currentDocumentChange" + EVENT_NAMESPACE, _didChangeCurrentDocument);
 		_setCurrentDocument(DocumentManager.getCurrentDocument()); 

 		$(FunctionTracker).on("didUpdateTrackedFunctions" + EVENT_NAMESPACE, _didUpdateTrackedFunctions);
 		$(TypeInformationStore).on("didUpdateTypeInformation" + EVENT_NAMESPACE, _didUpdateTypeInformation);
 	}

 	function _didChangeCurrentDocument (event, newDocument, oldDocument) {
 		_setCurrentDocument(newDocument);
 	}

 	function _setCurrentDocument (newDocument) {
 		currentDocument = newDocument;
 		// _addFunctionIdentifiersInDocument(currentDocument);
 		// _parseInformationFromDocument(currentDocument);
 	}

 	function _didUpdateTypeInformation (evt, typeInformation) {
 		DocumentManager.getDocumentForPath(typeInformation.file).done(function (doc) {
 			updateDocumentWithTypeInformation(doc, typeInformation);
 		}); 
 		
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
			var functionName = functionInfo.functionName || "anonymous";
			var typeInformation = {
				functionIdentifier: document.file.fullPath + "-function-" + functionName + "-" + Math.random().toString(36).substr(2,5),
				file: document.file.fullPath
			};
			var functionIdentifierJSDoc = " * " + TypeInformationJSDocRenderer.functionIdentifierToJSDoc(typeInformation.functionIdentifier) + "\n";
			var commentInset = _commentInsetForDocumentAndFunctionInfo(document, functionInfo); 
			if (functionInfo.commentRange !== undefined) {
				var commentAsTypeInformation = _updateTypeInformationWithCommentRange({}, document, functionInfo.commentRange);
				_.merge(typeInformation, commentAsTypeInformation);
				if (commentAsTypeInformation.functionIdentifier === undefined) {
					document.replaceRange(commentInset + functionIdentifierJSDoc, { line: functionInfo.commentRange.end.line, ch: 0 });
				}
			} else {
				var newCommentText = "\n" + commentInset + "/**\n" + commentInset + functionIdentifierJSDoc + commentInset + " */";
				document.replaceRange(newCommentText, functionInfo.functionRange.start);
			}
			results.push(typeInformation);
		}

		if (! documentWasDirty) {
			CommandManager.execute(Commands.FILE_SAVE, document);
		}

		$(exports).trigger("didReceiveTypeInformation", [ exports, results, false ]);
	}

	/**
	 * Iterates through the comment blocks and extracts JSDoc type information
	 * @param  {Document} document
	 * @param  {Object with function Ids -> functionLocations} indexedFunctions
	 */
	function _parseInformationFromDocument (document, indexedFunctions) {
		var results = [];

		_.forOwn(indexedFunctions, function (functionInfo, functionIdentifier) {
			var typeInformation = _updateTypeInformationWithCommentRange({ file: document.file.fullPath }, document, functionInfo.commentRange);
			results.push(typeInformation);
		});
		
		$(exports).trigger("didReceiveTypeInformation", [ exports, results, false ]); 
	}

	/**
	 * Update document with information from the given typespec
	 * @param {TypeInformation} typeInformation 
	 */
	function updateDocumentWithTypeInformation (document, typeInformation) { 
		$(FunctionTracker).off(EVENT_NAMESPACE);

		var functionInfo = FunctionTracker.functionLocationForFunctionIdentifier(typeInformation.functionIdentifier);
		var documentWasDirty = document.isDirty; 
			
		if ((functionInfo !== undefined) && 
			(functionInfo.commentRange !== undefined)) {
			//&&
			// (document.file.fullPath === typeInformation.path))

			var jsDocString = TypeInformationJSDocRenderer.typeInformationToJSDoc(typeInformation); 
			var commentInset = _commentInsetForDocumentAndFunctionInfo(document, functionInfo);

			var commentLines = jsDocString.split("\n");
			commentLines = _.map(commentLines, function (line) {
				return commentInset + " * " + line;
			});

			var newComment = commentInset + "/**\n" + commentLines.join("\n") + "\n" + commentInset + " */";
			document.replaceRange(newComment, functionInfo.commentRange.start, functionInfo.commentRange.end);
			
			if (! documentWasDirty) {
				CommandManager.execute(Commands.FILE_SAVE, document);
			}
		} else {
			TIUtils.log("Something went wrong, called update with typeInformation for other document or untracked function.");
		}

		$(FunctionTracker).on("didUpdateTrackedFunctions" + EVENT_NAMESPACE, _didUpdateTrackedFunctions);
	}

	function _commentInsetForDocumentAndFunctionInfo (document, functionInfo) {
		var commentInset;
		if (functionInfo.commentRange !== undefined) {
			commentInset = document.getRange({ line: functionInfo.commentRange.start.line, ch: 0 }, functionInfo.commentRange.start);
		} else {
			commentInset = document.getRange({ line: functionInfo.functionRange.start.line, ch: 0 }, functionInfo.functionRange.start);
		}

		return commentInset;
	}

	function _updateTypeInformationWithCommentRange (typeInformation, document, commentRange) {
		var commentText = document.getRange(commentRange.start, commentRange.end);
		commentText = commentText.replace(/^\s*(?:\*\/?|\/\*\*)/mg, "");
		return TypeInformationJSDocRenderer.updateTypeInformationWithJSDoc(typeInformation, commentText);	
	}

	exports.init = init; 
	exports.updateDocumentWithTypeInformation = updateDocumentWithTypeInformation;
});