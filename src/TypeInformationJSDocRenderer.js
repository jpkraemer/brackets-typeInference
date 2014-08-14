/*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, maxerr: 50 */
/*global define, $, brackets, Mustache */

define(function (require, exports, module) {
	"use strict"; 

	var _ 				= require("./lib/lodash");
	var doctrine 		= require("./lib/doctrine");
	var TIUtils			= require("./TIUtils");

	/**
	 * A hash storing the converter functions for jsDoc Tags
	 * @type {Object}
	 */
	var converters = {
		/**
		 * Converter for the param tag
		 * @param  {TypeInformation} typeInformation This typespec is udpated and returned.
		 * @param  {jsDocObject} jsdoc
		 * @return {TypeInformation} incomplete
		 */
		param: function (typeInformation, jsDoc) {
			var typeSpec = _jsdocTypeToTypeSpec(jsDoc.type); 
			typeSpec.name = jsDoc.name === null ? undefined : jsDoc.name; 
			typeSpec.description = jsDoc.description === null ? undefined : jsDoc.description; 

			//search for the parameter in the existing typeSpec
			if (typeInformation.argumentTypes === undefined) {
				typeInformation.argumentTypes = [];
			}

			var indexOfOldType = _.findIndex(typeInformation.argumentTypes, { name: typeSpec.name });
			if (indexOfOldType > -1) {
				typeInformation.argumentTypes[indexOfOldType] = typeSpec; 
			} else {
				typeInformation.argumentTypes.push(typeSpec);
			}

			return typeInformation;
		},

		return: function (typeInformation, jsDoc) {
			if (jsDoc.type !== undefined) {
				typeInformation.returnType = _jsdocTypeToTypeSpec(jsDoc.type);
				typeInformation.returnType.description = jsDoc.description === null ? undefined : jsDoc.description; 
			}

			return typeInformation;
		},

		uniqueFunctionIdentifier: function (typeInformation, jsDoc) {
			typeInformation.functionIdentifier = jsDoc.description; 
			return typeInformation;
		}
	}; 

	/**
	 * Updates the given type information with the information obtained from the JSDoc snippet
	 * @param  {TypeInformation} typeInformation
	 * @param  {String} jsdocString
	 * @return {TypeInformation}
	 */
	function updateTypeInformationWithJSDoc (typeInformation, jsdocString) {
		var jsdoc = doctrine.parse(jsdocString);

		typeInformation.description = jsdoc.description === null ? undefined : jsdoc.description; 

		for (var i = 0; i < jsdoc.tags.length; i++) {
			var jsdocTag = jsdoc.tags[i]; 

			if (converters.hasOwnProperty(jsdocTag.title)) {
				typeInformation = converters[jsdocTag.title](typeInformation, jsdocTag); 
			} else {
				TIUtils.log("Cannot convert jsdocTag " + jsdocTag.title); 
			}
		}

		return typeInformation; 
	}

	/**
	 * Helper function converting the type part of a doctrine-parsed JSDoc to a typespec
	 * @param  {Object} jsdocType
	 * @return {Typespec}
	 */
	function _jsdocTypeToTypeSpec(jsdocType) { 
		var result = {}; 
		//sanity check
		if ((jsdocType === null) || (jsdocType.type === null)) {
			return result; 
		}

		switch (jsdocType.type) {
			case "NameExpression":
				result.type = jsdocType.name.toLowerCase(); 
				var splitAtDot = result.type.split("."); 
				if (splitAtDot.length === 2) {
					result.type = splitAtDot[0];
					result.count = Number(splitAtDot[1]);
				}
				
				if (result.type === "array") {
					result.spec = [];
				} else if (result.type === "object") {
					result.spec = {};
				}
				
				break; 
			case "UnionType":
				result.type = "multiple"; 
				result.spec = _.map(jsdocType.elements, _jsdocTypeToTypeSpec); 
				break;
			case "ArrayType":
				result.type = "array";
				result.spec = _.map(jsdocType.elements, _jsdocTypeToTypeSpec);
				break;
			case "RecordType":
				result.type = "object"; 
				result.spec = {}; 
				for (var i = 0; i < jsdocType.fields.length; i++) {
					var jsdocField = jsdocType.fields[i]; 
					result.spec[jsdocField.key] = _jsdocTypeToTypeSpec(jsdocField.value);
				}
				break; 
		}

		return result;
	}

	/**
	 * Generates @param JSDoc entries from the given argument types 
	 * @param  {Typespec} argumentTypes
	 * @return {String}
	 */
	function typeSpecToJSDoc(type, isArgument) {
		var templateValues = {
			type: _jsDocTypeStringForTypespec(type),
			description: type.description
		};

		var template;
		if (isArgument) {
			templateValues.name = type.name;
			template = require("text!./templates/param-jsdoc.txt");
		} else {
			template = require("text!./templates/return-jsdoc.txt");
		}
	
		return Mustache.render(template, templateValues); 
	}

	function typeInformationToJSDoc (typeInformation) {
		var template = require("text!./templates/full-jsdoc.txt");
		var templateValues = {
			description: typeInformation.description,
			functionIdentifier: typeInformation.functionIdentifier
		};

		if (typeInformation.returnType !== undefined) {
			templateValues.returnType = {
				type: _jsDocTypeStringForTypespec(typeInformation.returnType), 
				description: typeInformation.returnType.description
			};
		}

		if (typeInformation.argumentTypes !== undefined) {
			templateValues.argumentTypes = _.map(typeInformation.argumentTypes, function (type) {
				var result = _.pick(type, "name", "description"); 
				result.type = _jsDocTypeStringForTypespec(type);
			});
		}

		return Mustache.render(template, typeInformation, {
			param: require("text!./templates/param-jsdoc.txt"),
			return: require("text!./templates/return-jsdoc.txt")
		}); 
	}

	/**
	 * Generates the type portion of a JSDoc @param entry
	 * @param  {Typespec} type
	 * @return {String}
	 */
	function _jsDocTypeStringForTypespec (type) {
		var result = ""; 

		if (type !== undefined) {
			switch (type.type) {
				case "array": 
					result = "[" + _.map(type.spec, _jsDocTypeStringForTypespec).join(', ') + "]";
					break;
				case "object":
					result = "{ "; 
					result +=  _.chain(type.spec)
									.mapValues(_jsDocTypeStringForTypespec)
									.pairs()
									.map(function (pair) { return pair.join(": "); })
									.value()
									.join(", ");
					result += " }";
					break; 
				case "multiple":
					result = "(" + _.pluck(type.spec, "type").join("|") + ")";
					break; 
				default: 
					result = type.type;
			}

			if (type.hasOwnProperty("count")) {
				result += "." + type.count; 
			}
		}

		return result;
	}

	function functionIdentifierToJSDoc (functionIdentifier) {
		return "@uniqueFunctionIdentifier " + functionIdentifier;
	}

	exports.typeSpecToJSDoc = typeSpecToJSDoc;
	exports.typeInformationToJSDoc = typeInformationToJSDoc; 
	exports.functionIdentifierToJSDoc = functionIdentifierToJSDoc;
	exports.updateTypeInformationWithJSDoc = updateTypeInformationWithJSDoc;

});