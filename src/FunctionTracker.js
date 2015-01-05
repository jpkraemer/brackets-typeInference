/*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, maxerr: 50 */
/*global define, $, brackets, Mustache */

define(function (require, exports, module) {
 	"use strict"; 

 	var _ 				= require("./lib/lodash");
 	var Document 		= brackets.getModule("document/Document").Document;
 	var Esprima			= require("./node/node_modules/esprima/esprima");

 	var EVENT_NAMESPACE = "FunctionTracker";

 	/**
 	 * @class TILocation Generic location class
 	 */
 	function TILocation (line, ch) {
 		_.bindAll(this);

 		this.line = line;
 		this.ch = ch;
 	}

 	TILocation.prototype.constructor = TILocation;
 	TILocation.prototype.line = undefined;
 	TILocation.prototype.ch = undefined; 

	/**
 	 * @class TIRange Generic range class
 	 */
 	function TIRange (start, end) {
 		_.bindAll(this);

 		this.start = start;
 		this.end = end;
 	}

 	TIRange.prototype.constructor = TIRange;
 	TIRange.prototype.start = undefined;
 	TIRange.prototype.end = undefined; 

 	TIRange.prototype.containsRange = function (otherRange) {
 		var startOfABeforeB = 	(this.start.line < otherRange.start.line) || 
								((this.start.line === otherRange.start.line) && (this.start.ch <= otherRange.start.ch)); 
		var endOfAAfterB = 		(this.end.line > otherRange.end.line) ||
								((this.end.line === otherRange.end.line) && (this.end.ch >= otherRange.end.ch)); 

		return startOfABeforeB && endOfAAfterB;
 	};

 	/**
 	 * @class FunctionInformation Encapsulates all location information about a function
 	 */
 	function FunctionInformation (document) {
 		_.bindAll(this);

 		this._document = document;
	}

 	FunctionInformation.prototype.constructor = FunctionInformation;

 	FunctionInformation.prototype._functionIdentifier = undefined;
 	FunctionInformation.prototype._document = undefined;
 	FunctionInformation.prototype._name = undefined; 
 	FunctionInformation.prototype._functionRange = undefined;
 	FunctionInformation.prototype._functionBookmarks = undefined;
 	FunctionInformation.prototype._commentRange = undefined;
 	FunctionInformation.prototype._commentBookmarks = undefined;

 	Object.defineProperties(FunctionInformation.prototype, {
 		"functionIdentifier": {
 			get: function () { return this._functionIdentifier; },
 			set: function () { throw new Error("Should not change functionIdentifier"); }
 		},
 		"name": {
 			get: function () { return this._name; },
 			set: function () { throw new Error("Should not change name"); }
 		},
 		"functionRange": {
 			get: function () { 
 				if (this._functionBookmarks !== undefined) {
 					if (this.document._masterEditor) {
	 					this._functionRange = new TIRange(this._functionBookmarks.start.find(), this._functionBookmarks.end.find());
 					} else {
 						this._functionBookmarks = undefined;
 					}
 				}

 				return this._functionRange; 
 			},
 			set: function () { throw new Error("Should not change functionRange"); }
 		},
 		"commentRange": {
 			get: function () { 
 				if (this._commentBookmarks !== undefined) {
 					if (this.document._masterEditor) {
	 					this._commentRange = new TIRange(this._commentBookmarks.start.find(), this._commentBookmarks.end.find());
 					} else {
 						this._commentBookmarks = undefined;
 					}
 				}

 				return this._commentRange; 
 			},
 			set: function () { throw new Error("Should not change commentRange"); }
 		},
 		"document": {
 			get: function () { return this._document; }, 
 			set: function () { throw new Error("Should not set document"); }
 		}
 	});

	/**
	 * Give every document one Function Tracker
	 */
	Object.defineProperties(Document.prototype, {
		"functionTracker": {
			get: function () {
				if ((this._functionTracker === undefined) && (this.language.getMode() === "javascript")) {
					this._functionTracker = new FunctionTracker(this);
				}

				return this._functionTracker;
			},
			set: function () { throw new Error("Should not set functionTracker"); }
		}
	});

	/**
	 * @class FunctionTracker This class keeps track of where in the document each function is.
	 */
	function FunctionTracker (document) {
		_.bindAll(this);

		this._document = document;
		this._functionInformationArray = [];

		this.document.addRef();
		$(this.document).on("change", this.reload);

		this.reload();
	}

	FunctionTracker.prototype.constructor = FunctionTracker;

	FunctionTracker.prototype._document = undefined;
	FunctionTracker.prototype._functionInformationArray = undefined;

	Object.defineProperties(FunctionTracker.prototype, {
		"document": {
			get: function () { return this._document; }, 
			set: function () { throw new Error("Should not set document"); }
		}
	});

	FunctionTracker.prototype.getFunctionInformationForIdentifier = function (functionIdentifier) {
		return _.find(this._functionInformationArray, { functionIdentifier: functionIdentifier });
	};

	FunctionTracker.prototype.getAllFunctions = function () {
		return this._functionInformationArray;
	}; 

	//todo potentially this is more than one
	FunctionTracker.prototype.functionInfoAtLocationInDocument = function (loc, skipAnonymous) {
		if (skipAnonymous === undefined) {
			skipAnonymous = true;
		}

		var searchFunctions;
		if (skipAnonymous) {
			searchFunctions = _.pick(this._functionInformationArray, function (value) { 
				return value.name !== undefined;
			});
		} else {
			searchFunctions = this._functionInformationArray;
		}

		return _.find(searchFunctions, function (functionInfo) {
			return functionInfo.functionRange.containsRange({ start: loc, end: loc });
		});
	};

	FunctionTracker.prototype.reload = function () {
		var parseAst = function (node, filter, callback) {
			var nextNodes = []; 
			var i; 
			var propertiesToCheckFor = ["body", "consequent", "alternate", "expression", "right"]; 

			for (i = 0; i < propertiesToCheckFor.length; i++) {
				var property = propertiesToCheckFor[i]; 
				if (node[property]) {
					if (Array.isArray(node[property])) {
						nextNodes = nextNodes.concat(node[property]);
					} else {
						nextNodes.push(node[property]);
					}
				}
			}

			_.forEach(nextNodes, function (child) {
				child.parent = node;
			});

			_(nextNodes).filter(filter).each(callback);
			
			for (i = 0; i < nextNodes.length; i++) {
				parseAst(nextNodes[i], filter, callback);
			}
		};

		var esprimaLocationToRange = function (loc) {
			return new TIRange (
				new TILocation(loc.start.line - 1, loc.start.column),
				new TILocation(loc.end.line - 1, loc.end.column)
			);
		};

		var nameFromExpressionLhs = function (node) {
			if (node.type === "Identifier") {
				return node.name;
			} else if (node.type === "MemberExpression") {
				return nameFromExpressionLhs(node.object) + "." + nameFromExpressionLhs(node.property);
			} else {
				return undefined;
			}
		};

		//try to use esprima first
		var ast; 
		var syntaxCorrect = true; 

		try {
			ast = Esprima.parse(this.document.getText(), {
				attachComment: true,
				loc: true,
				tolerant: true
			}); 
		} catch (e) {
			syntaxCorrect = false;
		}

		if (syntaxCorrect) {
			this._functionInformationArray = [];

			parseAst(ast, function (node) {
				return (node.type === "FunctionDeclaration") || (node.type === "FunctionExpression"); 
			}, function (node) {
				if ((node.type === "FunctionExpression") && (node.parent.type !== "AssignmentExpression")) {
					return; 
				}

				var functionInfo = new FunctionInformation(this.document);

				//try to find a unique function identifer
				var leadingComments = (node.type === "FunctionDeclaration") ? node.leadingComments : node.parent.parent.leadingComments;
				if (leadingComments !== undefined) {
					for (var i = 0; i < leadingComments.length; i++) {
						var commentNode = leadingComments[i];
						if (commentNode.type === "Block") {
							functionInfo._commentRange = esprimaLocationToRange(commentNode.loc);

							var match = commentNode.value.match(/^\s*\*\s*@uniqueFunctionIdentifier (\S*)/m);
							if (match) {
								functionInfo._functionIdentifier = match[1];
								break;
							}				
						}
					}
				}

				if (node.id) {
					functionInfo._name = node.id.name;
				} else {
					functionInfo._name = nameFromExpressionLhs(node.parent.left); 
					if (functionInfo._name === undefined) {
						functionInfo._name = "anonymous";
					}
				}

				if (functionInfo._functionIdentifier === undefined) {
					var nameAndParents = functionInfo._name;
					if (node.type === "FunctionDeclaration") {
						var parentNode = node.parent;
						while (parentNode) {
							var parentName;
							if (parentNode.id !== undefined) {
								parentName = parentNode.id.name;
							} else if (parentNode.type === "Program") {
								parentName = parentNode.type;
							} else {
								parentName = "anonymous" + parentNode.type;
							}
							nameAndParents = parentName + "." + nameAndParents;
							parentNode = parentNode.parent;
						}
					}

					functionInfo._functionIdentifier = (this.document.file.fullPath + "-function-" + nameAndParents).replace(/\s/g, "");

					//usually there should be no duplicates, i.e. two methods named equally in the same scope
					var duplicateNumber = 1;
					while (_.some(this._functionInformationArray, { functionIdentifier: functionInfo._functionIdentifier })) {
						functionInfo._functionIdentifier += duplicateNumber;
					}
				}

				if (node.type = "FunctionDeclaration") {
					functionInfo._functionRange = esprimaLocationToRange(node.loc); 
				} else {
					functionInfo._functionRange = esprimaLocationToRange(node.parent.loc); 
				}

				if (this.document._masterEditor) {
					functionInfo._functionBookmarks = {
						start: this.document._masterEditor._codeMirror.setBookmark(functionInfo.functionRange.start),
						end: this.document._masterEditor._codeMirror.setBookmark(functionInfo.functionRange.end)
					};
					if (functionInfo.commentRange !== undefined) {
						functionInfo._commentBookmarks = {
							start: this.document._masterEditor._codeMirror.setBookmark(functionInfo.commentRange.start),
							end: this.document._masterEditor._codeMirror.setBookmark(functionInfo.commentRange.end)
						};
					}
				}
				
				this._functionInformationArray.push(functionInfo);
			}.bind(this));

			$(this).trigger("change");
		}
	};
});