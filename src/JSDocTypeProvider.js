/*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, maxerr: 50 */
/*global define, $, brackets, Mustache */

/** 
 * Triggers: 
 * didReceiveTypeInformation - Triggered whenever new method arguments were collected. 
 */

define(function (require, exports, module) {
	"use strict"; 

	var DocumentManager 				= brackets.getModule("document/DocumentManager");
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
		_parseInformationFromDocument(currentDocument);
	}

	function _parseInformationFromDocument (document) {
		if (document.getLanguage().getId() === "javascript") { 
			var functions = JSUtils.findAllMatchingFunctionsInText(document.getText(), "*");
			var results = [];
			var line;
			var i, j;

			for (i = 0; i < functions.length; i++) {
				var functionLocation = functions[i];

				j = functionLocation.lineStart - 1; 
				var endOfCommentOrCodeFound = false; 
				var foundComment = false; 
				do {
					line = document.getLine(j);
					if (!foundComment) {
						foundComment = /^\s*\*\//.test(line); 
						endOfCommentOrCodeFound = (! foundComment) && (! /^\s*$/.test(line));
					} else {
						endOfCommentOrCodeFound = /^\s*\/\*\*/.test(line);
					}
					j--;
				} while (!endOfCommentOrCodeFound);

				if (foundComment) {
					var commentText = document.getRange({ line: j + 1, ch: 0 }, { line: functionLocation.lineStart, ch: 0 });
					commentText = commentText.replace(/^\s*(?:\*\/?|\/\*\*)/mg, "");

					var functionIdentifier = document.file.fullPath + "-function-" + 
						(functionLocation.lineStart + 1) + "-" + 
						document.getLine(functionLocation.lineStart).indexOf("function") + "-" +
						(functionLocation.lineEnd + 1) + "-" +
						(document.getLine(functionLocation.lineEnd).indexOf("}") + 1);

					var typeInformation = TypeInformationJSDocRenderer.updateTypeInformationWithJSDoc(
						{ functionIdentifier: functionIdentifier }, 
						commentText);
					results.push(typeInformation);
				}
			}

			$(exports).trigger("didReceiveTypeInformation", [ results ]); 
		}
	}

	exports.init = init; 

});