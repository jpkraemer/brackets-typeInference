 /*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, maxerr: 50 */
/*global define, $, brackets, Mustache */

define(function (require, exports, module) {
	"use strict"; 

	var _ 					= require("./lib/lodash");
	var Document 			= brackets.getModule("document/Document");

	/**
	 * @class TypeInformation This class represents type information for a single argument 
	 */	
	function TypeInformation () {
		_.bindAll(this);

		this.name = ""; 
		this.description = "";
	}

	TypeInformation.prototype.constructor = TypeInformation; 

	TypeInformation.prototype.name = undefined; 
	TypeInformation.prototype.description = undefined; 
	TypeInformation.prototype.type = undefined; 

	/**
	 * Type constants for TypeSpec.type
	 */
	var TypeSpecType = {
		stringType: 	"string",
		numberType: 	"number",
		booleanType: 	"boolean",
		functionType: 	"function",
		arrayType: 		"array",
		objectType: 	"object",
		anyType: 		"any",
		multipleType: 	"multiple"
	};

	/**
	 * @class TypeSpec This class represents a type spec for a single type
	 */	
	function TypeSpec () {
		_.bindAll(this);
	}

	TypeSpec.prototype.constructor = TypeSpec;

	TypeSpec.prototype.type = undefined;
	TypeSpec.prototype.spec = undefined;
	TypeSpec.prototype.count = undefined;

	/**
	 * @class FunctionTypeInformation This class represents type information for a complete method
	 */
	function FunctionTypeInformation (functionIdentifier) {
		_.bindAll(this);

		this._functionIdentifier = functionIdentifier; 
		this.description = "";
	}

	FunctionTypeInformation.prototype.constructor = FunctionTypeInformation;

	FunctionTypeInformation.prototype._functionIdentifier = undefined;

	FunctionTypeInformation.prototype.argumentTypes = undefined; 
	FunctionTypeInformation.prototype.returnType = undefined; 
	FunctionTypeInformation.prototype.description = undefined;

	FunctionTypeInformation.prototype.lastArguments = undefined;

	Object.defineProperties(FunctionTypeInformation.prototype, {
		"functionIdentifier": {
			get: function () { return this._functionIdentifier; },
			set: function () { throw new Error("Should not change function identifier."); }
		}
	});

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
	 * @class TypeInformationCollection A collection of type information specific to one document.
	 */	
	function TypeInformationCollection (document) {
		_.bindAll(this);
		
		this._document = document;
		this._functionTypeInformationArray = []; 

		this._loadingPromise = new $.Deferred();
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

	TypeInformationCollection.prototype.load = function () {
		//todo
	};

	TypeInformationCollection.prototype.save = function () { 
		//todo
	};

});