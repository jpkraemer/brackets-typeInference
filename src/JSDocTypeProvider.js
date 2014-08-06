/*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, maxerr: 50 */
/*global define, $, brackets, Mustache */

/** 
 * Triggers: 
 * didReceiveTypeInformation - Triggered whenever new method arguments were collected. 
 */

 define(function (require, exports, module) {
 	"use strict"; 

 	var DocumentManager 				= brackets.getModule("document/DocumentManager");
 	var Commands            			= brackets.getModule("command/Commands");
 	var CommandManager			 		= brackets.getModule("command/CommandManager");
 	var JSUtils 						= brackets.getModule("language/JSUtils");
 	var TypeInformationJSDocRenderer 	= require("./TypeInformationJSDocRenderer");

 	var currentDocument;

 	function init () {
 		$(DocumentManager).on("currentDocumentChange", _didChangeCurrentDocument);

 		_setCurrentDocument(DocumentManager.getCurrentDocument()); 
 	}

 	function _didChangeCurrentDocument (event, newDocument, oldDocument) {
 		_setCurrentDocument(newDocument);
 	}

 	function _setCurrentDocument (newDocument) {
 		currentDocument = newDocument;
 		_addFunctionIdentifiersInDocument(currentDocument);
 		_parseInformationFromDocument(currentDocument);
 	}

	/**
	 * Iterates through all the functions and adds unique identifiers to the jsdoc source. These can then be used by fondue and other parsers.
	 * @param {Document} document
	 */
	function _addFunctionIdentifiersInDocument (document) {
		var documentWasDirty = document.isDirty;

		_iterateFunctions(document, function (functionInfo, commentFound, commentInfo) {
	 		
			var functionIdentifier = document.file.fullPath + "-function-" + functionInfo.name + "-" + Math.random().toString(36).substr(2,5);
			var foundFunctionIdentifier = false; 
			var commentInset = new Array(functionInfo.startLoc.ch + 1).join(" "); 

			if (commentFound) {
				var commentAsTypeInformation = TypeInformationJSDocRenderer.updateTypeInformationWithJSDoc({}, commentInfo.textContent);
				if (commentAsTypeInformation.functionIdentifier !== undefined) {
					foundFunctionIdentifier = true;
				} else {
					commentInset = new Array(commentInfo.startLoc.ch + 1).join(" ");
				}
			}

			if (!foundFunctionIdentifier) {
				var newText = commentInset + " * " + TypeInformationJSDocRenderer.functionIdentifierToJSDoc(functionIdentifier) + "\n"; 
				if (commentFound) {
					document.replaceRange(newText, { line: commentInfo.endLoc.line, ch: 0 });
				} else {
					newText = "/**\n" + newText + " */\n";
					document.replaceRange(newText, functionInfo.startLoc);
				}
			}
		});

		if (! documentWasDirty) {
			CommandManager.execute(Commands.FILE_SAVE, document);
		}
	}

	/**
	 * Iterates through the comment blocks and extracts JSDoc type information
	 * @param  {[type]} document
	 * @return {[type]}
	 */
	function _parseInformationFromDocument (document) {
		var results = [];

		_iterateFunctions(document, function (functionInfo, commentFound, commentInfo) {
			if (commentFound) {
				var typeInformation = TypeInformationJSDocRenderer.updateTypeInformationWithJSDoc({ file: document.file.fullPath }, commentInfo.textContent);
				results.push(typeInformation);
			}
		});

		$(exports).trigger("didReceiveTypeInformation", [ results ]); 
	}

	/**
	 * This function iterates through the functions in a document and fires a callback for each. 
	 * The callback gets the following parameters: 
	 * {{ name: String, startLoc: { line: number, ch: number }, endLoc: { line: number, ch: number } }} functionInfo 
	 * {boolean} commentFound
	 * {{ textContent: string, startLoc: { line: number, ch: number }, endLoc: { line: number, ch: number } }} commentInfo
	 * 
	 * @param  {[type]}   document
	 * @param  {Function} callback
	 * @return {[type]}
	 */
	function _iterateFunctions (document, callback) {
	 	if (document.getLanguage().getId() === "javascript") { 
	 		var functions = JSUtils.findAllMatchingFunctionsInText(document.getText(), "*");
	 		var results = [];
	 		var line;
	 		var i, j;

	 		//make sure to iterate through the functions from the back of the file to the top, so insertions don't change line indexes
	 		functions.reverse(); 
	 		for (i = 0; i < functions.length; i++) {
	 			var functionLocation = functions[i];

	 			var endOfCommentOrCodeFound = false; 
	 			var commentFound = false; 
	 			var commentInfo = {
	 				startLoc: {},
	 				endLoc: {}
	 			}; 

	 			j = functionLocation.lineStart - 1; 
	 			do {
	 				if (j < 0) {
	 					break;
	 				}
	 				line = document.getLine(j);
	 				if (!commentFound) {
	 					commentFound = /^\s*\*\//.test(line); 
	 					commentInfo.endLoc.line = j;
	 					commentInfo.endLoc.ch = line.match(/^\s*/)[0].length;
	 					endOfCommentOrCodeFound = (! commentFound) && (! /^\s*$/.test(line));
	 				} else {
	 					endOfCommentOrCodeFound = /^\s*\/\*\*/.test(line);
	 				}
	 				j--;
	 			} while (!endOfCommentOrCodeFound);

	 			if (commentFound) {
	 				commentInfo.startLoc.line = j + 1; 
	 				commentInfo.startLoc.ch = document.getLine(j + 1).match(/^\s*/)[0].length;

	 				commentInfo.textContent = document.getRange(commentInfo.startLoc, commentInfo.endLoc);
					commentInfo.textContent = commentInfo.textContent.replace(/^\s*(?:\*\/?|\/\*\*)/mg, "");
	 			} else {
	 				commentInfo = undefined;
	 			}

	 			var functionInfo = {
	 				name: functionLocation.name, 
	 				startLoc: {
	 					line: functionLocation.lineStart,
	 					ch: document.getLine(functionLocation.lineStart).search(/function/)
	 				}, 
	 				endLoc: {
	 					line: functionLocation.lineEnd, 
	 					ch: document.getLine(functionLocation.lineEnd).search(/\}/) + 1
	 				}
	 			};

	 			callback(functionInfo, commentFound, commentInfo);
	 		}
	 	}
	}

	exports.init = init; 

});