/*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, maxerr: 50 */
/*global define, $, brackets, Mustache */

/**
 * Dispatches the following events: 
 * didUpdateTrackedFunctions - passes two parameters: 	trackedFunctions - as returned by functionLocationsInCurrentDocument
 * 														unidentifiedFunctions -  as returned by functionLocationsWithoutIdInCurrentDocument
 * 														change - the change that resulted in the update
 */

define(function (require, exports, module) {
	"use strict"; 

	var _ 								= require("./lib/lodash");
	var DocumentManager 				= brackets.getModule("document/DocumentManager");
	var JSUtils 						= brackets.getModule("language/JSUtils");
	var TypeInformationJSDocRenderer 	= require("./TypeInformationJSDocRenderer");
	var Esprima							= require("./node/node_modules/esprima/esprima");

	var EVENT_NAMESPACE = ".type-inference";

	var trackedFunctions = {};
	var untrackedFunctions = [];
	var referencedEditor; 
	var referencedDocument;

	function init () {
		$(DocumentManager).on("currentDocumentChange", _currentDocumentChanged); 

		_currentDocumentChanged(null, DocumentManager.getCurrentDocument(), null);
	}

	/**
	 * Used to access all functions with a unique id
	 * @return {{ FunctionIds: { functionLocation: Range, commentLocation: range } }} 
	 */
	function functionLocationsInCurrentDocument() {
		return _.mapValues(trackedFunctions, function (value) {
			return _(value).omit(["commentBookmarks", "functionBookmarks"]).cloneDeep();
		});
	}

	function functionLocationForFunctionIdentifier (functionIdentifier) {
		return _(trackedFunctions[functionIdentifier]).omit(["commentBookmarks", "functionBookmarks"]).cloneDeep();
	}

	function functionLocationsWithoutIdInCurrentDocument () {
		return _.cloneDeep(untrackedFunctions);
	}

	function _currentDocumentChanged (event, currentDocument, previousDocument) {
		if (referencedEditor !== undefined) {
			$(referencedEditor).off(EVENT_NAMESPACE);
			referencedEditor = undefined;
		}

		if (referencedDocument !== undefined) {
			$(referencedDocument).off(EVENT_NAMESPACE); 
			referencedDocument.releaseRef();
			referencedDocument = undefined;
		}

		_clearInformation();

		if (currentDocument.getLanguage().getMode() !== "javascript") {
			return; 
		}

		referencedDocument = currentDocument; 
		referencedEditor = referencedDocument._masterEditor; 
		referencedDocument.addRef(); 
		$(referencedDocument).on("change" + EVENT_NAMESPACE, _onDocumentChanged);
		_onDocumentChanged();
		
		$(referencedEditor).on("cursorActivity" + EVENT_NAMESPACE, function () {
			if (referencedEditor.hasSelection()) {
				var selection = referencedEditor.getSelection(); 
				_.each(trackedFunctions, function (functionInfo, functionIdentifier) {
					if (_rangeContainsRange(selection, functionInfo.functionRange)) {
						if (! _rangeContainsRange(selection, functionInfo.commentRange)) {
							selection = _rangeContainingRanges(selection, functionInfo.commentRange);
						}
					}
				});

				//actually including the commment is not enough, needs one line before
				if (selection.start.line === 0) {
					selection.start.ch = 0;
				} else {
					selection.start.line = selection.start.line - 1; 
					selection.start.ch = currentDocument.getLine(selection.start.line).length - 1;
				}
				referencedEditor.setSelection(selection.start, selection.end);
			}
		});	
	}

	/**
	 * Checks if range b is contained within range a
	 * @param  {{ start: { line: number, ch: number }, end: { line: number, ch: number } }} a
	 * @param  {{ start: { line: number, ch: number }, end: { line: number, ch: number } }} b
	 * @return {boolean}
	 */
	function _rangeContainsRange (a, b) {
		var startOfABeforeB = 	(a.start.line < b.start.line) || 
								((a.start.line === b.start.line) && (a.start.ch <= b.start.ch)); 
		var endOfAAfterB = 		(a.end.line > b.end.line) ||
								((a.end.line === b.end.line) && (a.end.ch >= b.end.ch)); 

		return startOfABeforeB && endOfAAfterB;
	}

	/**
	 * Returns the minimal range containing both ranges a and b
	 * @param  {{ start: { line: number, ch: number }, end: { line: number, ch: number } }} a
	 * @param  {{ start: { line: number, ch: number }, end: { line: number, ch: number } }} b
	 * @return {{ start: { line: number, ch: number }, end: { line: number, ch: number } }}
	 */
	function _rangeContainingRanges (a, b) {
		var result = { start: {}, end: {} }; 
		
		result.start.line = Math.min(a.start.line, b.start.line);
		result.start.ch = (a.start.line < b.start.line) ? a.start.ch : b.start.ch;
		if (a.start.line === b.start.line) { 
			result.start.ch = Math.min(a.start.ch, b.start.ch);
		}

		result.end.line = Math.max(a.end.line, b.end.line);
		result.end.ch = (a.end.line > b.end.line) ? a.end.ch : b.end.ch;
		if (a.end.line === b.end.line) { 
			result.end.ch = Math.max(a.end.ch, b.end.ch);
		}

		return result;
	}

	function _onDocumentChanged (event, changes) {
		var parseAst = function (node, filter, callback) {
			if (node.body !== undefined) {
				_(node.body).where(filter).each(callback);
				var nextNodes = []; 
				var i; 
				var propertiesToCheckFor = ["body", "consequent", "alternate"]; 

				for (i = 0; i < propertiesToCheckFor.length; i++) {
					var property = propertiesToCheckFor[i]; 
					if (node[property] !== undefined) {
						if (Array.isArray(node[property])) {
							nextNodes.concat(node[property]);
						} else {
							nextNodes.push(node[property]);
						}
					}
				}
				
				for (i = 0; i < node.body.length; i++) {
					parseAst(node.body[i], filter, callback);
				}
			}
		};

		var esprimaLocationToRange = function (loc) {
			return {
				start: {
					line: loc.start.line - 1,
					ch: loc.start.column	
				},
				end: {
					line: loc.end.line - 1, 
					ch: loc.end.column
				}
			};
		};

		//try to use esprima first
		var ast; 
		var syntaxCorrect = true; 

		try {
			ast = Esprima.parse(referencedDocument.getText(), {
				attachComment: true,
				loc: true,
				tolerant: true
			}); 
		} catch (e) {
			syntaxCorrect = false;
		}

		if (syntaxCorrect) {
			_clearInformation();

			parseAst(ast, { type: "FunctionDeclaration" }, function (node) {
				var functionInfo;

				if (node.leadingComments !== undefined) {
					//try to find a unique function identifer
					for (var i = 0; i < node.leadingComments.length; i++) {
						var commentNode = node.leadingComments[i];
						if (commentNode.type === "Block") {
							var functionName; 
							if (node.id !== undefined) {
								functionName = node.id.name;
							}

							functionInfo = {
								commentRange: esprimaLocationToRange(commentNode.loc),
								functionRange: esprimaLocationToRange(node.loc),
								functionName: functionName
							};
							var match = commentNode.value.match(/^\s*\*\s*@uniqueFunctionIdentifier (\S*)/m);
							if (match) {
								var functionIdentifier = match[1];
								functionInfo.commentBookmarks = {
									start: referencedEditor._codeMirror.setBookmark(functionInfo.commentRange.start),
									end: referencedEditor._codeMirror.setBookmark(functionInfo.commentRange.end)
								};

								functionInfo.functionBookmarks = {
									start: referencedEditor._codeMirror.setBookmark(functionInfo.functionRange.start),
									end: referencedEditor._codeMirror.setBookmark(functionInfo.functionRange.end)
								};

								trackedFunctions[functionIdentifier] = functionInfo;
								break;
							} else {
								untrackedFunctions.push(functionInfo);
							}				
						}
					}
				} else {
					functionInfo = {
						functionRange: esprimaLocationToRange(node.loc)
					};
					untrackedFunctions.push(functionInfo);
				}
			});
		} else {
		//if esprima did not work, just update the bookmarks 
			_.forOwn(trackedFunctions, function (locationInfo, functionIdentifier) {
				locationInfo.commentRange.start 	= locationInfo.commentBookmarks.start.find();
				locationInfo.commentRange.end 	= locationInfo.commentBookmarks.end.find();
				locationInfo.functionRange.start = locationInfo.functionBookmarks.start.find();
				locationInfo.commentRange.end 	= locationInfo.functionBookmarks.end.find();
			});
		}		

		$(exports).trigger("didUpdateTrackedFunctions", [ functionLocationsInCurrentDocument(), functionLocationsWithoutIdInCurrentDocument(), changes ]);
	}

	function _clearInformation () {
		_(trackedFunctions).pluck("commentBookmarks").each(function (bookmark) {
			bookmark.start.clear();
			bookmark.end.clear();
		});
		_(trackedFunctions).pluck("functionBookmarks").each(function (bookmark) {
			bookmark.start.clear();
			bookmark.end.clear();
		});
		trackedFunctions = {};
		untrackedFunctions = [];
	}

	exports.init = init;
	exports.functionLocationsInCurrentDocument = functionLocationsInCurrentDocument; 
	exports.functionLocationForFunctionIdentifier = functionLocationForFunctionIdentifier;
	exports.functionLocationsWithoutIdInCurrentDocument = functionLocationsWithoutIdInCurrentDocument;
});