 /*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, maxerr: 50 */
/*global define, $, brackets, Mustache */

define(function (require, exports, module) {
	"use strict"; 

	var _ 							= require("./lib/lodash");
	var Document 					= brackets.getModule("document/Document").Document;
	var DocumentManager 			= brackets.getModule("document/DocumentManager");
	var DocumentCommandHandlers 	= brackets.getModule("document/DocumentCommandHandlers");
	var FileUtils					= brackets.getModule("file/FileUtils");
	var FunctionTypeInformation 	= require("./FunctionTypeInformation").FunctionTypeInformation;
	var TIUtils						= require("./TIUtils");

	/**
	 * Add a typeInformationCollection to every JS document
	 */
	Object.defineProperties(Document.prototype, {
		"typeInformationCollection": {
			get: function () { 
				if ((this._typeInformationCollection === undefined) && (this.language.getMode() === "javascript")) {
					this._typeInformationCollection = new TypeInformationCollection(this);
				}

				return this._typeInformationCollection;
			},
			set: function () { throw new Error("Should not set typeInformationCollection"); }
		}
	});

	/**
	 * Change document saving to write type information to document first
	 */
	var oldWriteText = FileUtils.writeText; 
	FileUtils.writeText = function (file, text, force) { 
		var documents = DocumentManager.getAllOpenDocuments(); 
		var document = _.find(documents, { file: file });
		if (document.language.getMode() === "javascript") {
			document.typeInformationCollection.save();
			text = document.getText(true);
		}
		return oldWriteText.apply(null, [file, text, force]);
	};

	/**
	 * @class TypeInformationCollection A collection of type information specific to one document.
	 */	
	function TypeInformationCollection (document) {
		_.bindAll(this);
		
		this._document = document;
		this._functionTypeInformationArray = []; 

		this.load();
	}

	TypeInformationCollection.prototype.constructor = TypeInformationCollection; 

	TypeInformationCollection.prototype._document = undefined; 
	TypeInformationCollection.prototype._functionTypeInformationArray = undefined;
	TypeInformationCollection.prototype._loadingPromise = undefined;

	Object.defineProperties(TypeInformationCollection.prototype, {
		"document": {
			get: function () { return this._document; },
			set: function () { throw new Error("Should not change document"); }
		},
		"loadingPromise": {
			get: function () { return this._loadingPromise.promise(); },
			set: function () { throw new Error("Should not change loadingPromise"); }	
		}
	});

	TypeInformationCollection.prototype.typeInformationForFunctionIdentifier = function(functionIdentifier) {
		return _.find(this._functionTypeInformationArray, { functionIdentifier: functionIdentifier });
	};

	TypeInformationCollection.prototype.load = function () {
		this._functionTypeInformationArray = [];

		var allFunctions = this.document.functionTracker.getAllFunctions(); 
		for (var i = 0; i < allFunctions.length; i++) {
			var functionInformation = allFunctions[i];
			var functionTypeInformation; 
			if (functionInformation.commentRange !== undefined) {
				var commentText = this.document.getRange(functionInformation.commentRange.start, functionInformation.commentRange.end);
				commentText = commentText.replace(/^\s*(?:\*\/?|\/\*\*)/mg, "");
				functionTypeInformation = new FunctionTypeInformation(functionInformation.functionIdentifier, commentText);
			} else {
				functionTypeInformation = new FunctionTypeInformation(functionInformation.functionIdentifier);
			}
			this._functionTypeInformationArray.push(functionTypeInformation);
		}
	};

	TypeInformationCollection.prototype.save = function () { 
		var _commentInsetForDocumentAndFunctionInfo = function (functionInfo) {
			var commentInset;
			if (functionInfo.commentRange !== undefined) {
				commentInset = this.document.getRange({ line: functionInfo.commentRange.start.line, ch: 0 }, functionInfo.commentRange.start);
			} else {
				commentInset = this.document.getRange({ line: functionInfo.functionRange.start.line, ch: 0 }, functionInfo.functionRange.start);
			}

			return commentInset;
		}.bind(this);

		var prependInsetAndStars = function (commentInset, line) {
			return commentInset + " * " + line;
		};

		for (var i = 0; i < this._functionTypeInformationArray.length; i++) {
			var typeInformation = this._functionTypeInformationArray[i];
			var functionInfo = this.document.functionTracker.getFunctionInformationForIdentifier(typeInformation.functionIdentifier);
		
			var jsDocString = typeInformation.toJSDoc(); 
			var commentInset = _commentInsetForDocumentAndFunctionInfo(functionInfo);

			var commentLines = jsDocString.split("\n");
			commentLines = _.map(commentLines, prependInsetAndStars.bind(null, commentInset));

			var newComment = commentInset + "/**\n" + commentLines.join("\n") + "\n" + commentInset + " */";

			if (functionInfo.commentRange !== undefined) {
				this.document.replaceRange(newComment, functionInfo.commentRange.start, functionInfo.commentRange.end);
			} else {
				newComment += "\n";
				this.document.replaceRange(newComment, functionInfo.functionRange.start);
			}
		}
	};
});