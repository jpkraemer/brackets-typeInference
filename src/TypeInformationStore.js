/*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, maxerr: 50 */
/*global define, $, brackets, Mustache */

/**
 * Typespecs look like this: 
 * { 
 * 		type: 	string 	Can be string, number, boolean, function
 * 		spec: 	object 	With more precise spec. This is for arrays an array of typespecs, for objects a key value store with typespecs for each key
 * 		count: 	number	Required in typespecs in array specs. Used to signify repetition
 * 	}
 *
 * 
 */

define(function (require, exports, module) {
	"use strict"; 

	var _ 					= require("./lib/lodash");
	var ExtensionUtils 		= brackets.getModule("utils/ExtensionUtils");
	var NodeDomain			= brackets.getModule("utils/NodeDomain");
	var ProjectManager 		= brackets.getModule("project/ProjectManager");
	var TheseusTypeProvider	= require('./TheseusTypeProvider');
	var TIDatabase 			= new NodeDomain("TIDatabase", ExtensionUtils.getModulePath(module, "node/TIDatabaseDomain"));
	var TIUtils 			= require("./TIUtils");


	var projectRoot;
	var projectTypeDatabaseHandle;

	function _init () {

		_projectChanged(ProjectManager.getProjectRoot());

		//update project root continously
		$(ProjectManager).on("projectOpen", _projectOpened); 

		//register for updates from providers
		$(TheseusTypeProvider).on("didReceiveTypeInformation", _theseusDidReceiveTypeInformation); 
	}

	function _projectOpened (event, projectRoot) {
		TIUtils.log(projectRoot);
	}

	function _projectChanged (newProject) { 
		projectRoot = newProject;

		TIDatabase.exec("connect", projectRoot.fullPath + "bracketsProject.db").done(function (handle) {
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

		var successHandler = function (newDocs) {
			TIUtils.log("Successfully update type information: " + newDocs);
		};

		var errorHandler = function (err) {
			TIUtils.log("Error updating type information: " + err);
		};

		for (var i = results.length - 1; i >= 0; i--) {
			var result = results[i];

			var functionIdentifier = result.nodeId;
			var argumentTypes = _.chain(result.arguments).pluck("value").pluck("typeSpec").value();

			TIDatabase.exec("update", projectTypeDatabaseHandle, 
				{ functionIdentifier: functionIdentifier }, 
				{ $set: { 
					argumentTypes: argumentTypes,
					lastArguments: result.arguments 
				}},
				{ upsert: true }
			).done(successHandler).fail(errorHandler);
		}
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
});