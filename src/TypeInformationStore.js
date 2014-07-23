/*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, maxerr: 50 */
/*global define, $, brackets, Mustache */

/**
 * Typespecs look like this: 
 * { 
 * 		type: 	string 	Can be string, number, boolean, function, array, object, any, multiple (i.e., can be one of the types listed in spec)
 * 		spec: 	object 	With more precise spec. This is an array of typespecs for arrays and multiple, for objects a key value store with typespecs for each key
 * 		count: 	number or {min: number, max: number}	Required in typespecs in array specs. Used to signify repetition
 * 	}
 *
 * Notifications
 *
 * didUpdateTypeInformation - triggered when new type information is put into the store.
 * 
 */

define(function (require, exports, module) {
	"use strict"; 

	var _ 					= require("./lib/lodash");
	var Async				= brackets.getModule("utils/Async");
	var ExtensionUtils 		= brackets.getModule("utils/ExtensionUtils");
	var NodeDomain			= brackets.getModule("utils/NodeDomain");
	var ProjectManager 		= brackets.getModule("project/ProjectManager");
	var TheseusTypeProvider	= require('./TheseusTypeProvider');
	var TIDatabase 			= new NodeDomain("TIDatabase", ExtensionUtils.getModulePath(module, "node/TIDatabaseDomain"));
	var TIUtils 			= require("./TIUtils");

	var PRIMITIVE_TYPES 	= ["string", "number", "boolean", "function"];


	var projectRoot;
	var projectTypeDatabaseHandle;
	var queue;

	function _init () {

		_projectChanged(ProjectManager.getProjectRoot());

		//update project root continously
		$(ProjectManager).on("projectOpen", _projectOpened); 

		//register for updates from providers
		$(TheseusTypeProvider).on("didReceiveTypeInformation", _theseusDidReceiveTypeInformation); 
	}

	function _executeDatabaseCommand () {
		if (!queue) {
			queue = new Async.PromiseQueue();
		}

		var result = $.Deferred();
		var originalArguments = Array.prototype.slice.apply(arguments);

		queue.add(function () {
			if (originalArguments[0] !== "connect") {
				originalArguments.splice(1, 0, projectTypeDatabaseHandle);
			}
			return TIDatabase.exec.apply(TIDatabase, originalArguments)
				.done(function () { result.resolve.apply(result, arguments); })
				.fail(function () { result.reject.apply(result, arguments); });
		});

		return result.promise();
	}

	function typeInformationForFunctionIdentifer (functionIdentifier) {
		var result = $.Deferred();

		_executeDatabaseCommand("find", 
			{ functionIdentifier: functionIdentifier }
		).done(function (docs) {
			result.resolve(docs);
		}).fail(function (err) {
			TIUtils.log("Error retrieving type information for function identifier " + functionIdentifier + ": " + err);
			result.reject(err);
		});

		return result.promise();
	}

	function _projectOpened (event, projectRoot) {
		TIUtils.log(projectRoot);
	}

	function _projectChanged (newProject) { 
		projectRoot = newProject;

		_executeDatabaseCommand("connect", projectRoot.fullPath + "bracketsProject.db").done(function (handle) {
			projectTypeDatabaseHandle = handle;
		}).fail(function (err) {
			TIUtils.log("Error creating or loading database for project " + projectRoot.fullPath + " with Error: " + err);
		});
	}

	/**
	 * Callback fired by Theseus Type provider. Calculates arugment types and stores them to database. 
	 * @param  {Event} event
	 * @param  {[Theseus Traces]} results
	 */
	function _theseusDidReceiveTypeInformation (event, results) {
		if (!Array.isArray(results)) {
			results = [results];
		}

		for (var i = results.length - 1; i >= 0; i--) {
			var result = results[i];

			var functionIdentifier = result.nodeId;
			var argumentNames = _.pluck(result.arguments, "name");
			var argumentTypes = _.chain(result.arguments).pluck("value").pluck("typeSpec").value();
			for (var j = 0; j < argumentTypes.length; j++) {
				argumentTypes[j].name = argumentNames[j];
			}

			_updateTypeForFunctionWithTypesAndArguments(functionIdentifier, argumentTypes, result.arguments);
		}
	}

	/**
	 * This method updates type information. Type information degrades always to the most specific type spec possible, that still matches all arugments seen so far. 
	 * @param  {String} functionIdentifier
	 * @param  {[Typespec]} types
	 * @param  {[type]} arguments
	 */
	function _updateTypeForFunctionWithTypesAndArguments (functionIdentifier, types, argumentValues) {

		var successHandler = function (newDocs) {
			TIUtils.log("Successfully update type information: " + newDocs);
		};

		var errorHandler = function (err) {
			TIUtils.log("Error updating type information: " + err);
		};


		_executeDatabaseCommand("find", 
			{ functionIdentifier: functionIdentifier }
		).done(function (docs) {
			var newTypes = types;
			if (docs.length > 0) {
				if (docs.argumentTypes !== undefined) { 
					newTypes = _mergeTypeSpecs(types, docs.argumentTypes); 
				}
			}

			_executeDatabaseCommand("update",  
					{ functionIdentifier: functionIdentifier }, 
					{ $set: { 
						argumentTypes: newTypes,
						lastArguments: argumentValues 
					}},
					{ upsert: true }
				).done(function  (newDocs) {
					$(exports).trigger("didUpdateTypeInformation", [newDocs]); 
				}).fail(errorHandler);

		}).fail(errorHandler); 
	}

	/**
	 * Generalizes two typespecs to a single typespec that matches both 
	 * @param  {Typespec} typeA
	 * @param  {Typespec} typeB
	 * @return {Typespec}
	 */	
	function _mergeTypeSpecs (typeA, typeB) {
		var i, tmpType;

		var resultType = {};

		//merge count
		if (typeA.hasOwnProperty("count") && typeB.hasOwnProperty("count")) {
			//both appeared in an array. Really, if one of them did, the other should, too, otherwise something is really messed up
			resultType.count = _mergeCounts(typeA.count, typeB.count);
		}

		if (typeA.type !== typeB.type) {
			if ((_.contains(PRIMITIVE_TYPES, typeA.type)) && (_.contains(PRIMITIVE_TYPES, typeB.type))) {
				resultType.type = "multiple";
				resultType.spec = [
					{ type: typeA.type },
					{ type: typeB.type }
				];
			} else {
				resultType.type = "any";	
			}
			
			return resultType;
		} 

		resultType.type = typeA.type;

		//merge spec for arrays
		if (resultType.type === "array") {
			var minLength = Math.min(typeA.spec.length, typeB.spec.length);
			var mergedTypes = []; 

			for (i = 0; i < minLength; i++) {
				mergedTypes.push(_mergeTypeSpecs(typeA.spec[i], typeB.spec[i]));
			}

			var longerSpec = []; 
			if (i < typeA.spec.length) {
				longerSpec = typeA.spec;
			} else if (i < typeB.spec.length) {
				longerSpec = typeB.spec;
			}

			for (; i < longerSpec.length; i++) {
				tmpType = typeA.spec[i]; 
				tmpType.optional = true;
				mergedTypes.push(tmpType); 
			}

			//now in another pass through the array we need to merge adjacent entries that happen to be the same type
			i = 0; 

			var startOfSectionWithEqualTypeSpecs; 
			resultType.spec = [];

			var mergeTypesInRange = function (start, end) {
				var runningCountA = typeA.spec[start].count; 
				var runningCountB = typeB.spec[start].count; 
				for (var j = start + 1; j <= end; j++) {
					runningCountA = _addCounts(runningCountA, typeA.spec[j].count); 
					runningCountB = _addCounts(runningCountB, typeB.spec[j].count); 
				}

				mergedTypes[start].count = _mergeCounts(runningCountA, runningCountB);
				return mergedTypes[start];
			};

			for (i = 0; i < minLength - 1; i++)	{
				if (_isTypeSpecEqualToTypeSpec(mergedTypes[i], mergedTypes[i + 1], true)) {
					if (startOfSectionWithEqualTypeSpecs === undefined) {
						startOfSectionWithEqualTypeSpecs = i; 
					}
				} else {
					if (startOfSectionWithEqualTypeSpecs !== undefined) { 
						resultType.spec.push(mergeTypesInRange(startOfSectionWithEqualTypeSpecs, i));
						startOfSectionWithEqualTypeSpecs = undefined; 
					} else {
						resultType.spec.push(mergedTypes[i]); 	
					}
				}
			}

			if (startOfSectionWithEqualTypeSpecs !== undefined) {
				resultType.spec.push(mergeTypesInRange(startOfSectionWithEqualTypeSpecs, i));
			} else {
				resultType.spec.push(mergedTypes[i]);
			}

			resultType.spec = resultType.spec.concat(mergedTypes.slice(i + 1, mergedTypes.length));
			
		} else if (resultType.type === "object") {
			//merge spec for objects
			resultType.spec = {};
			var keys = _.union(Object.keys(typeA.spec), Object.keys(typeB.spec));

			for (i = keys.length - 1; i >= 0; i--) {
				var key = keys[i];

				if ((typeA.spec.hasOwnProperty(key)) && (typeB.spec.hasOwnProperty(key))) {
					resultType.spec[key] = _mergeTypeSpecs(typeA.spec[key], typeB.spec[key]); 
				} else {
					if (typeA.spec.hasOwnProperty(key)) {
						tmpType = typeA; 
					} else {
						tmpType = typeB;
					}

					resultType.spec[key] = tmpType.spec[key]; 
					resultType.spec[key].optional = true;
				}
			}
		}

		return resultType;
	}

	/**
	 * Merges the count information of two specs
	 * @param  {number or {min: number, max: number}} countA
	 * @param  {number or {min: number, max: number}} countB
	 * @return {number or {min: number, max: number}}
	 */
	function _mergeCounts (countA, countB) {
		if (typeof countA === "number") {
			countA = { min: countA, max: countA };
		}
		if (typeof countB === "number") {
			countB = { min: countB, max: countB };
		}

		var resultCount = {
			min: Math.min(countA.min, countB.min),
			max: Math.max(countA.max, countB.max)
		};

		if (resultCount.min === resultCount.max) {
			return resultCount.min;
		} //else
		return resultCount;
	}

	/**
	 * Adds the count information of two specs
	 * @param  {number or {min: number, max: number}} countA
	 * @param  {number or {min: number, max: number}} countB
	 * @return {number or {min: number, max: number}}
	 */
	function _addCounts (countA, countB) {
		if (typeof countA === "number") {
			countA = { min: countA, max: countA };
		}
		if (typeof countB === "number") {
			countB = { min: countB, max: countB };
		}

		var resultCount = {
			min: countA.min + countB.min,
			max: countA.max + countB.max
		};

		if (resultCount.min === resultCount.max) {
			return resultCount.min;
		} //else
		return resultCount;
	}

	/**
	 * Return if two typespecs are equal
	 * @param  {Typespec} a
	 * @param  {Typespec} b
	 * @param  {boolean} ignoreCount 
	 * @return {boolean}
	 */
	function _isTypeSpecEqualToTypeSpec (a, b, ignoreCount) {
		var i;

		if (ignoreCount === undefined) {
			ignoreCount = false;
		}

		var result = a.type === b.type; 
		
		if (!ignoreCount) {
			if (a.hasOwnProperty("count") && b.hasOwnProperty("count")) {
				result = result && (a.count === b.count);
			}
		}

		if (result === true) {
			if ((a.type === "array") || (a.type === "multiple")) {
				result = result && (a.spec.length === b.spec.length);

				i = 0; 
				while ((result === true) && (i < a.spec.length)) {
					if (a.type === "array") {
						result = result && _isTypeSpecEqualToTypeSpec(a.spec[i], b.spec[i]); 
					} else {
						result = result && _.some(b.spec, _isTypeSpecEqualToTypeSpec.bind(undefined, a.spec[i]));
					}
					i++;
				}
			} else if (a.type === "object") {
				var keysInA = Object.keys(a.spec); 
				var keysInB = Object.keys(b.spec);
				
				result = result && (keysInA.length === keysInB.length);

				i = 0; 
				while ((result === true) && (i < keysInA.length)) {
					result = result && keysInA[i] === keysInB[i]; 
					if (result === true) {
						var key = keysInA[i];
						result = result && _isTypeSpecEqualToTypeSpec(a.spec[key], b.spec[key]); 
					}
					i++;
				}
			}
		}

		return result;
	}

	/**
	 * This function calculates the most precise typespec for a value
	 * @param  {Any} value
	 * @return {Typespec}
	 */
	function _typeSpecFromValue (value) {
		var simpleType = typeof value; 
		if (_.contains(["string", "number", "boolean", "function"], simpleType)) {
			//easy one, we are done
			return { type: simpleType };
		} else if (simpleType === "array") { 
			var typeArr = value.map(_typeSpecFromValue); 

			var count = 0; 
			var type;
			var resultTypeArr = [];
			for (var i = typeArr.length - 1; i >= 0; i--) {
				if (type === typeArr[i]) {
					type.count ++; 
				} else {
					if (type !== undefined) { //this can only fail on the first element
						resultTypeArr.push(type);
					}
					type = typeArr[i];
					type.count = 1;
				}
			}
			resultTypeArr.push({ type: type, count: count});

			return { type: simpleType, spec: resultTypeArr };
		} else if (simpleType === "object") {
			var typeObject = _.mapValues(value, _typeSpecFromValue);

			return {type: simpleType, spec: typeObject};
		}
	}

	exports.init = _init;
	exports.mergeTypeSpecs = _mergeTypeSpecs;
	exports.forTests = {};
	exports.forTests.mergeCounts = _mergeCounts;
	exports.typeInformationForFunctionIdentifer = typeInformationForFunctionIdentifer;
	exports.PRIMITIVE_TYPES = PRIMITIVE_TYPES;
});