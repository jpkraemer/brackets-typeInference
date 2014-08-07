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
 * didUpdateTypeInformation(newTypeInformation) - triggered when new type information is put into the store.
 * 
 */

define(function (require, exports, module) {
	"use strict"; 

	var _ 					= require("./lib/lodash");
	var Async				= brackets.getModule("utils/Async");
	var ExtensionUtils 		= brackets.getModule("utils/ExtensionUtils");
	var JSDocTypeProvider 	= require("./JSDocTypeProvider");
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
		$(TheseusTypeProvider).on("didReceiveTypeInformation", _didReceiveTypeInformation); 
		$(JSDocTypeProvider).on("didReceiveTypeInformation", _didReceiveTypeInformation); 
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

	/**
	 * Returns a promise that resolves with the type information record for the given function identifier
	 * @param  {string} functionIdentifier
	 * @return {TypeInformation (Promise)}
	 */
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

	/**
	 * Returns a promise that resolves to the list of function identifiers in the given file
	 * @param {string} file 
	 * @return {[string]} Array of function identifiers
	 */
	function functionIdentifiersForFile (file) {
		var result = $.Deferred(); 

		_executeDatabaseCommand("find",
			{ file: file }
		).done(function (docs) {
			result.resolve(_.pluck(docs, "functionIdentifier"));
		}).fail(function (err) {
			TIUtils.log("Error retrieving function identifers in file " + file + ": " + err);
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
	 * Callback fired by Type providers. 
	 * @param  {Event} event
	 * @param  {[Type Information records]} results
	 */
	function _didReceiveTypeInformation (event, results) {
		var i, j;

		if (!Array.isArray(results)) {
			throw "[type-inference] Never call type information store updates with something that is not an array.";
		}

		results = _.groupBy(results, "functionIdentifier");

		_.forOwn(results, function (num, functionIdentifier) {
			var resultsForFunctionIdentifier = results[functionIdentifier];
			//if there is more then one result per function identifier, we premerge these. Only happens for live data providers, of course.
			var argumentTypeArrays = _.pluck(resultsForFunctionIdentifier, "argumentTypes");

			var aggregateTypes = argumentTypeArrays[0];
			for (i = 1; i < argumentTypeArrays.length; i++) {
				var currentTypes = argumentTypeArrays[i]; 

				if (currentTypes.length !== aggregateTypes.length) {
					aggregateTypes = currentTypes; 
				} else {
					for (j = 0; j < currentTypes.length; j++) {
						aggregateTypes[j] = _mergeTypeSpecs(currentTypes[j], aggregateTypes[j]); 
					}
				}
			}

			var mergedTypeInformation = _.last(resultsForFunctionIdentifier); 
			mergedTypeInformation.argumentTypes = aggregateTypes;
			
			_updateWithTypeInformation(mergedTypeInformation);
			// _updateTypeForFunctionWithTypesAndArguments(functionIdentifier, aggregateTypes, resultsForNodeId[resultsForNodeId.length - 1].arguments);	
		});
	}

	/**
	 * This method updates type information. Type information degrades always to the most specific type spec possible, that still matches all arugments seen so far. 
	 * @param  {String} functionIdentifier
	 * @param  {[Typespec]} types
	 * @param  {[type]} arguments
	 */
	function _updateWithTypeInformation (typeInformation) {

		var successHandler = function (newDocs) {
			TIUtils.log("Successfully update type information: " + newDocs);
		};

		var errorHandler = function (err) {
			TIUtils.log("Error updating type information: " + err);
		};

		_executeDatabaseCommand("find", 
			{ functionIdentifier: typeInformation.functionIdentifier }
		).done(function (docs) {
			var isUpdate = false;
			var doc;
			var propertiesToUpdate = {};
			
			if (docs.length > 0) {
				isUpdate = true; 
				doc = docs[0];
			} else {
				isUpdate = false;
				doc = typeInformation;
			}

			if (typeInformation.argumentTypes !== undefined) {
				var newTypes = typeInformation.argumentTypes;
			
				//types always changed if the record is new
				var typesDidChange = !isUpdate; 

				if (isUpdate) {
					if ((doc.argumentTypes !== undefined) && (doc.argumentTypes.length === typeInformation.argumentTypes.length)) {
						for (var i = 0; i < typeInformation.argumentTypes.length; i++) {
							newTypes[i] = _mergeTypeSpecs(typeInformation.argumentTypes[i], doc.argumentTypes[i]); 
							typesDidChange = typesDidChange || (! _.isEqual(newTypes[i], doc.argumentTypes[i]));
						}
					} else {
						//either length changed or type info was just added
						typesDidChange = true;
					}
				} 

				if (typesDidChange) {
					doc.argumentTypes = newTypes; 	
					propertiesToUpdate.argumentTypes = newTypes;	
				}
			}

			if (typeInformation.lastArguments !== undefined) {
				doc.lastArguments = typeInformation.lastArguments;
				propertiesToUpdate.lastArguments = typeInformation.lastArguments;
			}

			if (typeInformation.file !== undefined) {
				doc.file = typeInformation.file; 
				propertiesToUpdate.file = typeInformation.file;
			}

			if (_.size(propertiesToUpdate) > 0) {
				_executeDatabaseCommand("update",  
						{ functionIdentifier: typeInformation.functionIdentifier }, 
						{ $set: propertiesToUpdate },
						{ upsert: true }
					).done(function  (updateInfo) {
						if (typesDidChange) {
							if (updateInfo.newDoc !== undefined) {
								$(exports).trigger("didUpdateTypeInformation", [updateInfo.newDoc]); 	
							} else {
								$(exports).trigger("didUpdateTypeInformation", [doc]); 
							}
						}
					}).fail(errorHandler);
			}
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

		//use first name we can get 
		if (typeA.hasOwnProperty("name")) {
			resultType.name = typeA.name;
		} else if (typeB.hasOwnProperty("name")) {
			resultType.name = typeB.name;
		}

		//use the first description we can get
		if (typeA.description !== undefined) { 
			resultType.description = typeA.description;
		} else if (typeB.description !== undefined) { 
			resultType.description = typeB.description;
		}

		//merge count
		if (typeA.hasOwnProperty("count") || typeB.hasOwnProperty("count")) {
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
		if (countA === undefined) {
			return countB;
		} else if (countB === undefined) {
			return countA;
		}

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
	exports.functionIdentifiersForFile = functionIdentifiersForFile;
	exports.PRIMITIVE_TYPES = PRIMITIVE_TYPES;
});