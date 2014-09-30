/*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, maxerr: 50 */
/*global define, $, brackets, Mustache */

define(function (require, exports, module) {
	"use strict"; 

	var _ 								= require("./lib/lodash");
	var ExtensionLoader 				= brackets.getModule("utils/ExtensionLoader");

	//negative indexes facilitate ascending sorting
	var TYPE_SPEC_MATCHING_QUALITY = Object.freeze({
		NO_MATCH: 0, //typespec a does not match b
		GENERALIZING_MATCH: -1, //typespec a is more general than b
		FULFILMENT_MATCH: -2 //typespec a is more or as specific as b
	});

	function init () {
		ExtensionLoader.getRequireContextForExtension("JavaScriptCodeHints")([ "Session" ], function (Session) {
			var oldGetHints = Session.prototype.getHints; 

			Session.prototype.getHints = function(query, matcher) {
				var hints = oldGetHints.apply(this, arguments);
				var parameterHint;
				try {
					//the getParameterHints function is implemented in a way that it crashes when no call location is set
					//in this case we are not inside a function call anyways and don't care
					parameterHint = this.getParameterHint(); 
				} catch (e) {
					//ignore
				}

				if ((parameterHint !== undefined) && (parameterHint.currentIndex >= 0)) {
					var currentParameterHint = parameterHint.parameters[parameterHint.currentIndex]; 
					var goodMatches = _.remove(hints.hints, function (hint) {
						var hintTypeSpec = ternTypeToTypeSpec(hint);
						if (currentParameterHint !== undefined) {
							hint.typeSpecMatchingQuality = isTypeSpecMatchingTypeSpec(hintTypeSpec, currentParameterHint.typeInformation);
						} else {
							hint.typeSpecMatchingQuality = TYPE_SPEC_MATCHING_QUALITY.NO_MATCH;
						}
						return (hint.typeSpecMatchingQuality < 0);
					});
					goodMatches = _.sortBy(goodMatches, "typeSpecMatchingQuality");

					Array.prototype.unshift.apply(hints.hints, goodMatches);
				}

				return hints; 
			};
		});
	}

	/**
	 * Converts a tern type string to a typespec (as good as possible, they are terrible and documented nowhere)
	 * @param  {{value: string, type:string}} hint
	 * @return {TypeSpec}
	 */
	function ternTypeToTypeSpec (hint) {
		var result = {};
		if (hint.value !== undefined){
			result.name = hint.value;
		}

		var matches; 
		if (hint.type === undefined) {
			result.type = "any"; 
		} else if (hint.type === "number") {
			result.type = "number"; 
		} else if (hint.type === "string") {
			result.type = "string";
		} else if (hint.type === "bool") {
			result.type = "boolean";
		} else if ((matches = hint.type.match(/^fn\((.*)\) -> (.*)/)) !== null) {
			result.type = "function";
		} else if (hint.type === "?") {
			result.type = "any";
		} else if ((matches = hint.type.match(/^\[(.*)\]$/)) !== null) {
			result.type = "array";
			result.spec = [ ternTypeToTypeSpec({ type: matches[1] }) ];
		} else if ((matches = hint.type.match(/^\{(.*)\}$/)) !== null) {
			result.type = "object"; 
			var specString = matches[1];
			if ((specString !== "?") && (specString !== "")) {
				result.spec = {}; 
				var specStringParts = specString.split(","); 
				for (var i = 0; i < specStringParts.length; i++) {
					var partsString = specStringParts[i]; 
					partsString = $.trim(partsString);
					result.spec[partsString] = { type: "any" };
				}
			}
		}

		return result;
	}

	/**
	 * Checks if a typeSpec is a valid incarnation of a second typeSpec
	 * @param  {TypeSpec}  	a
	 * @param  {TypeSpec}  	b
	 * @param  {Boolean} 	ignoreCounts Defaults to true
	 * @return {number}
	 */
	function isTypeSpecMatchingTypeSpec (a, b, ignoreCounts) {
		var subresult;

		if (ignoreCounts === undefined) {
			ignoreCounts = true;
		}

		var result = TYPE_SPEC_MATCHING_QUALITY.NO_MATCH; 

		if ((a === undefined) || (b === undefined)) {
			return result;
		}

		if (b.type === "any") {
			result = TYPE_SPEC_MATCHING_QUALITY.FULFILMENT_MATCH;
		} else if (_.contains(["number", "boolean", "string", "function"], b.type)) {
			if (a.type === b.type) {
				result = TYPE_SPEC_MATCHING_QUALITY.FULFILMENT_MATCH;
			} else if (a.type === "any") {
				result = TYPE_SPEC_MATCHING_QUALITY.GENERALIZING_MATCH;
			}
		} else if ((b.type === "array") && (a.type === "array")) {
			if (b.spec !== undefined) {
				if (a.spec !== undefined) {
					if ((a.spec[0].type === "any") && (a.spec.length === 1)) {
						result = TYPE_SPEC_MATCHING_QUALITY.GENERALIZING_MATCH;
					} else {
						result = TYPE_SPEC_MATCHING_QUALITY.FULFILMENT_MATCH;
						for (var i = 0; i < b.spec.length; i++) {
							if (a.spec[i] !== undefined) {
								subresult = isTypeSpecMatchingTypeSpec(a.spec[i], b.spec[i], ignoreCounts);
								if (result > subresult) {
									result = subresult; 
								}
							} else {
								result = TYPE_SPEC_MATCHING_QUALITY.NO_MATCH;
								break;
							}
						}
					}
				} 
			} else {
				result = TYPE_SPEC_MATCHING_QUALITY.FULFILMENT_MATCH;
			}
		} else if ((b.type === "object") && (a.type === "object")) {
 			if (b.spec !== undefined) {
 				if (a.spec !== undefined) {
 					result = true;
 					_.forOwn(b.spec, function (value, key) {
 						if (a.spec[key] !== undefined) {
 							subresult = isTypeSpecMatchingTypeSpec(a.spec[i], b.spec[i], ignoreCounts);
 							if (result > subresult) {
 								result = subresult;
 							}
 						} else {
 							result = TYPE_SPEC_MATCHING_QUALITY.NO_MATCH;
 						}
 					});
 				} else {
 					result = TYPE_SPEC_MATCHING_QUALITY.GENERALIZING_MATCH;
 				}
 			} else {
 				result = TYPE_SPEC_MATCHING_QUALITY.FULFILMENT_MATCH;
 			}
		}

		if ((! ignoreCounts) && (b.count !== undefined)) { 
			result = _.isEqual(a.count, b.count) ? result : TYPE_SPEC_MATCHING_QUALITY.NO_MATCH;
		}

		return result;
	}

	exports.init = init;

});