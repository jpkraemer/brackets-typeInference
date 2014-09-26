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

	var _ 							= require("./lib/lodash");
	var Async						= brackets.getModule("utils/Async");
	var ExtensionUtils 				= brackets.getModule("utils/ExtensionUtils");
	var JSDocTypeProvider 			= require("./JSDocTypeProvider");
	var NodeDomain					= brackets.getModule("utils/NodeDomain");
	var ProjectManager 				= brackets.getModule("project/ProjectManager");
	var TheseusTypeProvider			= require('./TheseusTypeProvider');
	var TIDatabase 					= new NodeDomain("TIDatabase", ExtensionUtils.getModulePath(module, "node/TIDatabaseDomain"));
	var TIUtils 					= require("./TIUtils");


	var PRIMITIVE_TYPES = [ "string", "number", "boolean", "function" ];
	var TYPE_PROVIDERS = [ JSDocTypeProvider, TheseusTypeProvider, "DocumentationInlineEditor" ];

	var projectRoot;
	var projectTypeDatabaseHandle;
	var queue;

	var options = {
		mergeAutomaticUpdatesConservatively: false
	};

	Async.PromiseQueue.prototype.addFront = function (op) {
        this._queue.unshift(op);

        // If something is currently executing, then _doNext() will get called when it's done. If nothing
        // is executing (in which case the queue should have been empty), we need to call _doNext() to kickstart
        // the queue.
        if (!this._curPromise) {
            this._doNext();
        }
    };

	function _init () {

		_projectChanged(ProjectManager.getProjectRoot());

		//update project root continously
		$(ProjectManager).on("projectOpen", _projectOpened); 

		//register for updates from providers
		$(TheseusTypeProvider).on("didReceiveTypeInformation", _didReceiveTypeInformation); 
		$(JSDocTypeProvider).on("didReceiveTypeInformation", _didReceiveTypeInformation); 
	}

	function setOptions (newOptions) {
		_.merge(options, newOptions);
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

	function _executeDatabaseCommandNow () {
		if (!queue) {
			queue = new Async.PromiseQueue();
		}

		var result = $.Deferred();
		var originalArguments = Array.prototype.slice.apply(arguments);

		queue.addFront(function () {
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
	 * Returns a promise that resolves with the type information records found for the given function namen and file
	 * @param {string} functionName 
	 * @param {string} fullPath 
	 * @returns {TypeInformation (Promise)}
	 */
	function typeInformationForFunctionNameInFile (functionName, fullPath) {
		var result = $.Deferred(); 

		functionIdentifiersForFile(fullPath).done(function (docs) {
			var functionIdentifier = _.find(docs, function (aFunctionIdentifier) {
				var components = aFunctionIdentifier.split("-"); 
				return (components[components.length - 2] === functionName); 
			}); 

			if (functionIdentifier === undefined) {
				result.resolve(undefined); 
			} else {
				_executeDatabaseCommand("find",
					{ functionIdentifier: functionIdentifier }
				).done(function (docs) {
					result.resolve(docs); 
				}).fail(function (err) {
					TIUtils.log("Error retrieving type information for function name " + functionName + " in file " + fullPath + ": " + err);
					result.reject(err);
				});
			}
		}).fail(function (err) {
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
	 * This method is a straight forward to the didReceiveTypeInformation method. The only difference is, 
	 * that this one is exported. It is used for the Documentation Inline Editor that can not be required here, to avoid 
	 * circular references. 
	 * @param  {Object} provider the type provider triggering the update
	 * @param  {[Type Information records]} results
	 * @param  {boolean} isMerge If set to true, results from the new type information will be merged with the old one, 
	 * if false the existing record will be overwritten.
	 * @param  {boolean} shouldMergeConservatively If set to true, will use conservative merging strategy regardless of type provider
	 * */
	function userUpdatedTypeInformation (provider, results, isMerge, shouldMergeConservatively) {
		_didReceiveTypeInformation(null, provider, results, isMerge, shouldMergeConservatively);
	}

	/**
	 * Callback fired by Type providers. 
	 * @param  {Event} event
	 * @param  {Object} provider the type provider triggering the update
	 * @param  {[Type Information records]} results
	 * @param  {boolean} isMerge If set to true, results from the new type information will be merged with the old one, 
	 * if false the existing record will be overwritten.
	 * @param  {boolean} shouldMergeConservatively If set to true, will use conservative merging strategy regardless of type provider
	 */
	function _didReceiveTypeInformation (event, provider, results, isMerge, shouldMergeConservatively) {
		var i, j;

		if (!Array.isArray(results)) {
			throw "[type-inference] Never call type information store updates with something that is not an array.";
		}

		if ((provider.constructor !== undefined) && (provider.constructor.name === "DocumentationInlineEditor")) {
			provider = "DocumentationInlineEditor";
		}

		if (! _.contains(TYPE_PROVIDERS, provider)){
			throw "[type-inference] Update with invalid type provider";
		}

		results = _.groupBy(results, "functionIdentifier");

		_.forOwn(results, function (num, functionIdentifier) {
			var resultsForFunctionIdentifier = results[functionIdentifier];			
			_updateWithTypeInformation(provider, functionIdentifier, resultsForFunctionIdentifier, isMerge, shouldMergeConservatively);
		});
	}

	/**
	 * This method updates type information. Type information degrades always to the most specific type spec possible, that still matches all arugments seen so far. 
	 * @param {string|object} provider The provider of the update
	 * @param {string} functionIdentifier The function identifier for which information is being updated
	 * @param  {TypeInformation} new type information
	 * @param {boolean} isMerge If set to true, results from the new type information will be merged with the old one, 
	 * if false the existing record will be overwritten.
	 */
	function _updateWithTypeInformation (provider, functionIdentifier, typeInformationArray, isMerge, shouldMergeConservatively) {
		var successHandler = function (newDocs) {
			TIUtils.log("Successfully update type information: " + newDocs);
		};

		var errorHandler = function (err) {
			TIUtils.log("Error updating type information: " + err);
		};

		var overwriteMergePolicy = function (oldDoc, newDoc) {
			var betterIsEqual = function (a,b) {
				if ((typeof a === "object") && (typeof b === "object")) {
					var allKeys = _.union(_.keys(a), _.keys(b));
					var defaults = _.reduce(allKeys, function (result, key) {
						result[key] = undefined;
						return result;
					}, {});
					_.defaults(a, defaults);
					_.defaults(b, defaults);
				}

				return _.isEqual(a, b);
			};

			var result = {
				propertiesToUpdate: {},
				propertiesToRemove: {}
			};

			_.union(_.keys(newDoc), _.keys(oldDoc)).forEach(function(key) {
				//don't change the db-internal id
				if (key === "_id") {
					return;
				}

				if (newDoc[key] !== undefined) {
					var needsUpdate = true;
					if (oldDoc[key] !== undefined) {
						needsUpdate = ! betterIsEqual(newDoc[key], oldDoc[key]);
					}
					if (needsUpdate) {
						result.propertiesToUpdate[key] = newDoc[key];
					}
				} else {
					if (key !== "lastArguments") {
						result.propertiesToRemove[key] = true;
						oldDoc[key] = undefined;
					}
				}
			}); 

			return result;
		};

		var generalizingMergePolicy = function (oldDoc, newDoc) {
			var result = {
				propertiesToUpdate: {},
				propertiesToRemove: {}
			};

			if (newDoc.argumentTypes !== undefined) {
				var newTypes = newDoc.argumentTypes;
				var typesDidChange = false;

				if ((oldDoc.argumentTypes !== undefined) && (oldDoc.argumentTypes.length === newDoc.argumentTypes.length)) {
					for (var i = 0; i < newDoc.argumentTypes.length; i++) {
						newTypes[i] = _mergeTypeSpecs(newDoc.argumentTypes[i], oldDoc.argumentTypes[i]); 
						typesDidChange = typesDidChange || (! _.isEqual(newTypes[i], oldDoc.argumentTypes[i]));
					}
				} else {
					//either length changed or type info was just added
					typesDidChange = true;
				}

				if (typesDidChange) {
					result.propertiesToUpdate.argumentTypes = newTypes;	
				}
			} 

			if (newDoc.returnType !== undefined) {
				var newType = newDoc.returnType; 
				if (oldDoc.returnType !== undefined) {
					newType = _mergeTypeSpecs(newDoc.returnType, oldDoc.returnType);
					if (! _.isEqual(newType, oldDoc.returnType)) {
						result.propertiesToUpdate.returnType = newType;
					}
				} else {
					result.propertiesToUpdate.returnType = newType;
				}
			}

			_(newDoc).omit("argumentTypes", "returnType").forOwn(function(value, key) {
				if (! _.isEqual(oldDoc[key], newDoc[key])) {
					result.propertiesToUpdate[key] = newDoc[key];
				}
			});

			return result;
		};

		var conservativeMergePolicy = function (oldDoc, newDoc) {
			var comparatorIgnoringCount = function (a, b) {
				if (_.contains(PRIMITIVE_TYPES, a.type) && _.contains(PRIMITIVE_TYPES, b.type)) {
					return _.isEqual(_.omit(a, "count"), _.omit(b, "count"));
				}

				return undefined;
			};

			var result = {
				propertiesToUpdate: {},
				propertiesToRemove: {},
				original: _.cloneDeep(oldDoc),
				pendingChanges: { theseusInvocationId: newDoc.theseusInvocationId }
			};

			var generalizedResult = generalizingMergePolicy(oldDoc, newDoc);
			result.propertiesToUpdate = generalizedResult.propertiesToUpdate; 
			result.propertiesToRemove = generalizedResult.propertiesToRemove;

			if ((result.propertiesToUpdate.argumentTypes !== undefined) && (result.original.argumentTypes !== undefined)) {
				result.pendingChanges.argumentTypes = [];

				for (var i = 0; i < result.original.argumentTypes.length; i++) {
					var originalType = result.original.argumentTypes[i]; 
					var newType = result.propertiesToUpdate.argumentTypes[i];

					var isEqual = _.isEqual(newType, originalType, comparatorIgnoringCount);

					if (! isEqual) {
						result.pendingChanges.argumentTypes[i] = newType;
					}
				}

				if (result.pendingChanges.argumentTypes.length !== 0) {
					delete result.propertiesToUpdate.argumentTypes; 
				}
			} else if ((result.propertiesToRemove.argumentTypes) && (result.original.argumentTypes !== undefined)) {
				result.pendingChanges.argumentTypes = true;
				delete result.propertiesToRemove.argumentTypes;
			}

			if ((result.propertiesToUpdate.returnType !== undefined) && (result.original.returnType !== undefined)) {
				if (! _.isEqual(result.propertiesToUpdate.returnType, result.original.returnType, comparatorIgnoringCount)) {
					result.pendingChanges.returnType = result.propertiesToUpdate.returnType;
					delete result.propertiesToUpdate.returnType;
				}
			} else if ((result.propertiesToRemove.returnType) && (result.original.returnType !== undefined)) {
				result.pendingChanges.returnType = true;
				delete result.propertiesToRemove.returnType;
			}

			return result;
		};

		if (typeInformationArray.length === 0) {
			TIUtils.log("Empty update, aborting"); 
			return;
		}

		//duplicate _.merge
		var merge = function (a, b, keysToMergeByCopy) {
			_.forOwn(b, function (value, key) {
				if ((_.contains(["array", "object"], typeof b[key])) && 
					(_.contains(["array", "object"], typeof a[key])) &&
					(! _.contains(keysToMergeByCopy, key))) {

					merge(a[key], b[key]); 
				} else {
					a[key] = value;
				}
			});

			return a;
		};

		var filterAttributesInConflict = function (oldDoc, newDoc) {
			var originalNewDoc = _.cloneDeep(newDoc);
			var mergedResult = conservativeMergePolicy(oldDoc, newDoc);

			var result = {
				theseusInvocationId: mergedResult.pendingChanges.theseusInvocationId
			}; 
			if (mergedResult.pendingChanges.argumentTypes !== undefined) {
				result.argumentTypes = _.map(mergedResult.pendingChanges.argumentTypes, function (value, index) {
					if (value !== undefined) {
						return originalNewDoc.argumentTypes[index];
					} else {
						return undefined;
					}
				});
			}

			if (mergedResult.pendingChanges.returnType !== undefined) {
				result.returnType = mergedResult.pendingChanges.returnType;
			}

			return result;
		};

		_executeDatabaseCommand("find", 
			{ functionIdentifier: functionIdentifier }
		).done(function (docs) {
			var isUpdate = false;
			var doc;
			var typeInformation;
			var changes = {};
			var typesDidChange; 
			var pendingChanges;
			var i;
			
			if (shouldMergeConservatively === undefined) {
				shouldMergeConservatively = false;
			}

			if (docs.length > 0) {
				isUpdate = true; 
				doc = docs[0];
			} else {
				isUpdate = false;
			}

			typeInformation = _.cloneDeep(typeInformationArray[0]);

			if (typeInformationArray.length > 1) { 
				//premerge changes
				for (i = 1; i < typeInformationArray.length; i++) {
					var changesToMerge = generalizingMergePolicy(_.cloneDeep(typeInformation), _.cloneDeep(typeInformationArray[i])); 
					typeInformation = merge(typeInformation, changesToMerge.propertiesToUpdate, [ "lastArguments" ]); 
				}
			}

			if (! isUpdate) {
				doc = typeInformation;
				changes.propertiesToUpdate = doc;
				changes.propertiesToRemove = {};
			} else if (! isMerge) {
				changes = overwriteMergePolicy(doc, typeInformation); 
			} else if ((options.mergeAutomaticUpdatesConservatively && (provider === TheseusTypeProvider)) || shouldMergeConservatively) {
				pendingChanges = {};
				delete typeInformation.theseusInvocationId; 
				changes = conservativeMergePolicy(doc, typeInformation);
				pendingChanges.merge = changes.pendingChanges; 

				for (i = 0; i < typeInformationArray.length; i++) {
					var singleTypeInformation = typeInformationArray[i]; 
					var changesFromSingleTypeInformation = filterAttributesInConflict(doc, singleTypeInformation);
					pendingChanges[singleTypeInformation.theseusInvocationId] = changesFromSingleTypeInformation;
				}
			} else {
				changes = generalizingMergePolicy(doc, typeInformation);
			}

			merge(doc, changes.propertiesToUpdate);
			_.forOwn(changes.propertiesToRemove, function (shouldDelete, key) {
				if (shouldDelete) {
					delete doc[key];
				}
			});

			if ((_.size(changes.propertiesToUpdate) + _.size(changes.propertiesToRemove)) > 0) {
				_executeDatabaseCommandNow("update",  
						{ functionIdentifier: typeInformation.functionIdentifier }, 
						{ $set: changes.propertiesToUpdate, $unset: changes.propertiesToRemove },
						{ upsert: true }
					).done(function  (updateInfo) {
						if (updateInfo.newDoc !== undefined) {
							$(exports).trigger("didUpdateTypeInformation", [ updateInfo.newDoc ]);
						} else {
							$(exports).trigger("didUpdateTypeInformation", [ doc, pendingChanges ]); 
						}
					}).fail(errorHandler);
			} else if (pendingChanges) {
				$(exports).trigger('didUpdateTypeInformation', [ doc, pendingChanges ]);
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

		//merge optional
		if (typeA.optional || typeB.optional) {
			resultType.optional = true;
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
				tmpType = longerSpec[i]; 
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
	exports.setOptions = setOptions;
	exports.mergeTypeSpecs = _mergeTypeSpecs; 
	exports.typeInformationForFunctionIdentifer = typeInformationForFunctionIdentifer;
	exports.typeInformationForFunctionNameInFile = typeInformationForFunctionNameInFile;
	exports.functionIdentifiersForFile = functionIdentifiersForFile;
	exports.userUpdatedTypeInformation = userUpdatedTypeInformation; 
	exports.PRIMITIVE_TYPES = PRIMITIVE_TYPES;
	exports.forTests = {};
	exports.forTests.mergeCounts = _mergeCounts;
});