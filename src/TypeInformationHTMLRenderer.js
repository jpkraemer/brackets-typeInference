/*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, maxerr: 50 */
/*global define, $, brackets, Mustache */

define(function (require, exports, module) {
	"use strict"; 

	var _ 				= brackets.getModule("thirdparty/lodash");
	var marked 			= require("./node/node_modules/marked/lib/marked");

	/**
	 * This function converts type information into its HTML rendering
	 * @param  {Typeinformation} typeInformation The type information for a method obtained from the TypeInformationStore
	 * @return {jQueryObject}
	 */
	function typeInformationToHTML(typeInformation) {
		var $result = $("<div />");
		if (typeInformation.argumentTypes && (typeInformation.argumentTypes.length > 0)) {
			$result.append($("<h2 />").append("Parameters").addClass("ti-headline"));
			$result.append(argumentTypesToHTML(typeInformation.argumentTypes));
		}
		
		return $result;
	}

	function argumentTypesToHTML (argumentTypes) {
		var singleArgumentTemplate = require("text!./templates/singleArgument.html");
		var $result = $("<table />");

		for (var i = 0; i < argumentTypes.length; i++) {
			var type = argumentTypes[i];
			var templateValues = {
				name: type.name,
				type: _typeSpecToHTML(type)
			};

			if (type.description !== undefined) {
				templateValues.description = marked(type.description);
			}

			$result.append(Mustache.render(singleArgumentTemplate, templateValues)); 
		}

		return $result;
	}

	function _typeSpecToHTML (type) {
		var result; 

		switch (type.type) {
			case "array": 
				result = "[" + _.map(type.spec, _typeSpecToHTML).join(', ') + "]";
				break;
			case "object": 
				result = "{ "; 
				result +=  _(type.spec)
								.mapValues(_typeSpecToHTML)
								.pairs()
								.map(function (pair) { pair.join(": "); })
								.value()
								.join(", ");
				result += " }";

				if (result.length > 100) {
					//TODO: tree view object
				}

				break; 
			case "multiple":
				result = "(" + _.pluck(type.spec, "type").join(" <em>or</em> ") + ")";
				break;
			default: 
				result = type.type.charAt(0).toUpperCase() + type.type.slice(1);
		}

		if (type.hasOwnProperty("count")) {
			result += "<em>("; 
			if (typeof type.count === "number"){
				result += type.count;
			} else {
				result += type.count.min + "-" + type.count.max;
			}

			result += "x)</em>";
		}

		return result;
	}

	exports.typeInformationToHTML = typeInformationToHTML;

});