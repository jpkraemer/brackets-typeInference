/*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, maxerr: 50 */
/*global define, $, brackets, Mustache */

define(function (require, exports, module) {
	"use strict"; 

	var _ 			= require("./lib/lodash");
	var doctrine 	= require("./lib/doctrine");
	var TIUtils		= require("./TIUtils");

	/**
	 * @class TypeInformation This class represents type information for a single argument 
	 */	
	function TypeInformation (jsdocTag) {
		_.bindAll(this);

		this.name = ""; 
		this.description = "";

		if (jsdocTag) {
			this.name = jsdocTag.name === null ? undefined : jsdocTag.name; 
			this.description = jsdocTag.description === null ? undefined : jsdocTag.description; 
			this.type = new TypeSpec(jsdocTag.type);
		}
	}

	TypeInformation.prototype.constructor = TypeInformation; 

	TypeInformation.prototype.name = undefined; 
	TypeInformation.prototype.description = undefined; 
	TypeInformation.prototype.type = undefined; 

	TypeInformation.prototype.toJSDoc = function (asReturnType) {
		var templateValues = {
			name: this.name,
			description: this.description, 
			type: this.type.toJSDoc()
		}; 

		var template; 
		if (asReturnType) {
			template = require("text!./templates/return-jsdoc.txt");
		} else {
			template = require("text!./templates/param-jsdoc.txt");
		}

		return Mustache.render(template, templateValues);
	};

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
	function TypeSpec (jsdocType) {
		_.bindAll(this);

		if (jsdocType !== undefined) {
			//sanity check
			if ((jsdocType === null) || (jsdocType.type === null)) {
				return;
			}

			switch (jsdocType.type) {
				case "NameExpression":
					this.type = jsdocType.name.toLowerCase(); 
					var splitAtDot = this.type.split("."); 
					if (splitAtDot.length === 2) {
						this.type = splitAtDot[0];
						var countString = splitAtDot[1];
						var splitAtDash = countString.split("-");
						if (splitAtDash.length === 2) {
							this.count = {
								min: Number(splitAtDash[0]),
								max: Number(splitAtDash[1])
							};
						} else {
							this.count = Number(countString);
						}
					}

					if (this.type === "array") {
						this.spec = [];
					} else if (this.type === "object") {
						this.spec = {};
					}
					
					break; 
				case "UnionType":
					this.type = "multiple"; 
					this.spec = _.map(jsdocType.elements, function (jsdocType) {
						return new TypeSpec(jsdocType);
					}); 
					break;
				case "ArrayType":
					this.type = "array";
					this.spec = _.map(jsdocType.elements, function (jsdocType) {
						return new TypeSpec(jsdocType);
					});
					break;
				case "RecordType":
					this.type = "object"; 
					this.spec = {}; 
					for (var i = 0; i < jsdocType.fields.length; i++) {
						var jsdocField = jsdocType.fields[i]; 
						this.spec[jsdocField.key] = new TypeSpec(jsdocField.value);
					}
					break; 
			}
		}
	}

	TypeSpec.prototype.constructor = TypeSpec;

	TypeSpec.prototype.type = undefined;
	TypeSpec.prototype.spec = undefined;
	TypeSpec.prototype.count = undefined;

	TypeSpec.prototype.toJSDoc = function() {
		var result = ""; 

		switch (this.type) {
			case "array": 
				result = "[" + _.map(this.spec, function (typeSpec) { return typeSpec.toJSDoc(); }).join(', ') + "]";
				break;
			case "object":
				result = "{ "; 
				result +=  _.chain(this.spec)
								.mapValues(function (typeSpec) { return typeSpec.toJSDoc(); })
								.pairs()
								.map(function (pair) { return pair.join(": "); })
								.value()
								.join(", ");
				result += " }";
				break; 
			case "multiple":
				result = "(" + _.pluck(this.spec, "type").join("|") + ")";
				break; 
			default: 
				result = this.type;
		}

		if (this.count !== undefined) {
			if (typeof this.count === "number") {
				result += "." + this.count; 
			} else {
				result += "." + this.count.min + "-" + this.count.max;
			}
		}

		return result;
	};

	/**
	 * @class FunctionTypeInformation This class represents type information for a complete method
	 */
	function FunctionTypeInformation (functionIdentifier, jsdocString) {
		_.bindAll(this);

		this._functionIdentifier = functionIdentifier; 
		this.description = "";

		if (jsdocString !== undefined) {
			var propertiesFromJSDoc = this._parseJSDocString(jsdocString);
			_.forOwn(propertiesFromJSDoc, function (value, key) {
				this[key] = value;
			}.bind(this));
		}
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

	FunctionTypeInformation.prototype.updateWithJSDoc = function(jsdocString, editedPartTypeSpecifier) {
		var propertiesFromJSDoc = this._parseJSDocString(jsdocString);
		
		switch (editedPartTypeSpecifier.partType) {
			case "description":
				this.description = propertiesFromJSDoc.description;
				break; 
			case "parameters": 
				var oldArgumentType = this.argumentTypes[editedPartTypeSpecifier.id]; 
				var newArgumentTypeIndex = _.findIndex(propertiesFromJSDoc.argumentTypes, { name: oldArgumentType.name });
				if (newArgumentTypeIndex === -1) {
					this.argumentTypes.splice(editedPartTypeSpecifier.id, 1);
				} else {
					this.argumentTypes[editedPartTypeSpecifier.id] = propertiesFromJSDoc.argumentTypes[newArgumentTypeIndex];
					propertiesFromJSDoc.argumentTypes.splice(newArgumentTypeIndex, 1);
				}
				Array.splice.bind(null, editedPartTypeSpecifier.id, 0).apply(this.argumentTypes, propertiesFromJSDoc.argumentTypes);

				delete propertiesFromJSDoc.argumentTypes;
				break;
		}
		delete propertiesFromJSDoc.description; 

		if (propertiesFromJSDoc.returnType !== undefined) {
			this.returnType = propertiesFromJSDoc.returnType;
		}

		if (propertiesFromJSDoc.argumentTypes !== undefined) {
			if (editedPartTypeSpecifier.partType === "description") {
				Array.unshift.apply(this.argumentTypes, propertiesFromJSDoc.argumentTypes);
			} else if (editedPartTypeSpecifier.partType === "return") {
				this.argumentTypes.concat(propertiesFromJSDoc.argumentTypes);
			}
		}
	};

	/**
	 * This method parses a jsdoc string and returns an anonymous object with all the properties of a TypeInformation 
	 * @param  {string} jsdocString 
	 * @return {object} 
	 */
	FunctionTypeInformation.prototype._parseJSDocString = function(jsdocString) {
		var jsdoc = doctrine.parse(jsdocString, { recoverable: true });
		var result = {};

		result.description = jsdoc.description === null ? undefined : jsdoc.description; 

		for (var i = 0; i < jsdoc.tags.length; i++) {
			var jsdocTag = jsdoc.tags[i]; 

			switch (jsdocTag.title) {
				case "param":
					var typeInformation = new TypeInformation(jsdocTag);
					
					if (result.argumentTypes === undefined) {
						result.argumentTypes = [];
					}

					result.argumentTypes.push(typeInformation);
					break;
				case "return": 
					result.returnType = new TypeInformation(jsdocTag);
					break;
				default: 
					if (jsdocTag.title !== "uniqueFunctionIdentifier") {
						TIUtils.log("Unknown JSDoc Tag: ", jsdocTag.title);
					}
			}
		}

		return result; 
	};

	FunctionTypeInformation.prototype.toJSDoc = function() {
		var template = require("text!./templates/full-jsdoc.txt");
		var templateValues = {
			functionIdentifier: this.functionIdentifier,
			description: this.description,
			returnType: (this.returnType !== undefined) ? this.returnType.toJSDoc(true) : "",
			argumentTypes: this.argumentTypes.map(function (typeInformation) { return typeInformation.toJSDoc(); })
		};

		return Mustache.render(template, templateValues);
	};

	module.exports = FunctionTypeInformation;
});