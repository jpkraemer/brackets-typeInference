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
		 * @param  {jsDocObject} jsdoc
		 * @return {TypeInformation} incomplete
		 */
		param: function (typeInformation, jsdoc) {
			function _jsdocTypeToTypeSpec(jsdocType) { 
				var result = {}; 
				//sanity check
				if ((jsdocType === null) || (jsdocType.type === null)) {
					return result; 
				}

				switch (jsdocType.type) {
					case "NameExpression":
						result.type = jsdocType.name; 
						var splitAtDot = result.type.split("."); 
						if (splitAtDot.length === 2) {
							result.type = splitAtDot[0];
							result.count = Number(splitAtDot[1]);
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

				result.type = result.type.toLowerCase();

				return result;
			}

			var typeSpec = _jsdocTypeToTypeSpec(jsdoc.type); 
			typeSpec.name = jsdoc.name === null ? undefined : jsdoc.name; 
			typeSpec.description = jsdoc.description === null ? undefined : jsdoc.description; 

			//search for the parameter in the existing typeSpec
			var indexOfOldType = _.findIndex(typeInformation.argumentTypes, { name: typeSpec.name });
			if (indexOfOldType > -1) {
				typeInformation.argumentTypes[indexOfOldType] = typeSpec; 
			} else {
				typeInformation.argumentTypes.push(typeSpec);
			}

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

		if (jsdoc.description !== "") {
			typeInformation.description = jsdoc.description === null ? undefined : jsdoc.description; 
		}

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
	 * Generates @param JSDoc entries from the given argument types 
	 * @param  {Typespec} argumentTypes
	 * @return {String}
	 */
	function typeSpecToJSDocParam(type) {
		var paramTemplate = require("text!./templates/param-jsdoc.txt"); 
		var templateValues = {
			name: type.name,
			type: _jsDocTypeStringForTypespec(type),
			description: type.description
		};

		return Mustache.render(paramTemplate, templateValues); 
	}

	/**
	 * Generates the type portion of a JSDoc @param entry
	 * @param  {Typespec} type
	 * @return {String}
	 */
	function _jsDocTypeStringForTypespec (type) {
		var result; 

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

		return result;
	}

	exports.typeSpecToJSDocParam = typeSpecToJSDocParam;
	exports.updateTypeInformationWithJSDoc = updateTypeInformationWithJSDoc;

});