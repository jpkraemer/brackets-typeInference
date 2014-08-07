/*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, maxerr: 50 */
/*global define, $, brackets, Mustache */

define(function (require, exports, module) {
	"use strict"; 

	var _ 								= require("./lib/lodash");
	var DocumentManager 				= brackets.getModule("document/DocumentManager");
	var JSUtils 						= brackets.getModule("language/JSUtils");
	var TypeInformationJSDocRenderer 	= require("./TypeInformationJSDocRenderer");

	var EVENT_NAMESPACE = ".type-inference";

	var trackedFunctions = {};
	var referencedEditor; 

	function init () {
		$(DocumentManager).on("currentDocumentChange", _currentDocumentChanged); 

		_currentDocumentChanged(null, DocumentManager.getCurrentDocument(), null);
	}

	function _currentDocumentChanged (event, currentDocument, previousDocument) {
		if (referencedEditor !== undefined) {
			$(referencedEditor).off(EVENT_NAMESPACE);
		}
		referencedEditor = undefined;

		if (currentDocument.getLanguage().getMode() !== "javascript") {
			return; 
		}

		referencedEditor = currentDocument._masterEditor; 

		$(referencedEditor).on("cursorActivity" + EVENT_NAMESPACE, function () {
			if (referencedEditor.hasSelection()) {
				//clear tracked functions 
				trackedFunctions = {}; 

				_iterateFunctions(currentDocument, function (functionInfo, commentFound, commentInfo) {
					if (commentFound) {
						var functionIdentifier; 

						var commentAsTypeInformation = TypeInformationJSDocRenderer.updateTypeInformationWithJSDoc({}, commentInfo.textContent);
						if (commentAsTypeInformation.functionIdentifier !== undefined) {
							functionIdentifier = commentAsTypeInformation.functionIdentifier;
						}

						trackedFunctions[functionIdentifier] = {
							commentInfo: commentInfo, 
							functionInfo: functionInfo
						};
					}
				});

				var selection = referencedEditor.getSelection(); 
				var selectionRange = { startLoc: selection.start, endLoc: selection.end };
				_.each(trackedFunctions, function (functionSpec, functionIdentifier) {
					if (_rangeContainsRange(selectionRange, functionSpec.functionInfo)) {
						if (! _rangeContainsRange(selectionRange, functionSpec.commentInfo)) {
							selectionRange = _rangeContainingRanges(selectionRange, functionSpec.commentInfo);
						}
					}
				});

				//actually including the commment is not enough, needs one line before
				if (selectionRange.startLoc.line === 0) {
					selectionRange.startLoc.ch = 0;
				} else {
					selectionRange.startLoc.line = selectionRange.startLoc.line - 1; 
					selectionRange.startLoc.ch = currentDocument.getLine(selectionRange.startLoc.line).length - 1;
				}
				referencedEditor.setSelection(selectionRange.startLoc, selectionRange.endLoc);
			}
		});	
	}

	function _rangeContainsRange (a, b) {
		var startOfABeforeB = 	(a.startLoc.line < b.startLoc.line) || 
								((a.startLoc.line === b.startLoc.line) && (a.startLoc.ch <= b.startLoc.ch)); 
		var endOfAAfterB = 		(a.endLoc.line > b.endLoc.line) ||
								((a.endLoc.line === b.endLoc.line) && (a.endLoc.ch >= b.endLoc.ch)); 

		return startOfABeforeB && endOfAAfterB;
	}

	function _rangeContainingRanges (a, b) {
		var result = { startLoc: {}, endLoc: {} }; 
		
		result.startLoc.line = Math.min(a.startLoc.line, b.startLoc.line);
		result.startLoc.ch = (a.startLoc.line < b.startLoc.line) ? a.startLoc.ch : b.startLoc.ch;
		if (a.startLoc.line === b.startLoc.line) { 
			result.startLoc.ch = Math.min(a.startLoc.ch, b.startLoc.ch);
		}

		result.endLoc.line = Math.max(a.endLoc.line, b.endLoc.line);
		result.endLoc.ch = (a.endLoc.line > b.endLoc.line) ? a.endLoc.ch : b.endLoc.ch;
		if (a.endLoc.line === b.endLoc.line) { 
			result.endLoc.ch = Math.max(a.endLoc.ch, b.endLoc.ch);
		}

		return result;
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