/*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, maxerr: 50 */
/*global define, $, brackets, Mustache */

define(function (require, exports, module) {
	"use strict";

	var ExtensionUtils 					= brackets.getModule("utils/ExtensionUtils");
	var FileSystem						= brackets.getModule("filesystem/FileSystem");
	var FileUtils						= brackets.getModule("file/FileUtils");
	var NodeDomain 						= brackets.getModule("utils/NodeDomain");
	var ProjectManager 					= brackets.getModule("project/ProjectManager");
	var TestCaseCollection 				= require("./TestCaseCollection");
	var GeneratedTestCaseCollection 	= require("./GeneratedTestCaseCollection");
	var TITestRunner					= new NodeDomain("TITestRunner", ExtensionUtils.getModulePath(module, "node/TITestRunnerDomain"));
	var TIUtils 						= require("./TIUtils");

	var generatedTestCaseCollectionsByDocument = {};
    var testCaseCollectionsByName = {};
    var lastTestResults = {};
	var userGeneratedTestCaseCollections = [];
	var autogeneratedPrefix = "autogenerated_";

	function init () {
		$(ProjectManager).on("projectOpen", _onProjectOpen);
		_onProjectOpen();

		var $button = $("<a />").attr({
			id: "ti-runTests-toolbar-button",
			href: "#"
		});
		$button.on("click", runTests);
		$('#main-toolbar .buttons').append($button);
	}

	function runTests () {
		var projectRootDir = ProjectManager.getProjectRoot();
		if (! projectRootDir) {
			TIUtils.log("No project open.");
			return;
		}

		var testCasePath = projectRootDir.fullPath + "brackets_spec/";
		var jasminePath = ExtensionUtils.getModulePath(module, "node/node_modules/jasmine-node/lib/jasmine-node/cli.js");
		var nodeTheseusPath = ExtensionUtils.getModulePath(module, "node/node_modules/node-theseus/bin/node-theseus");
		var fullExecPath = nodeTheseusPath + " --theseus-port=8889 " + jasminePath;

		var $button = $('#main-toolbar .buttons #ti-runTests-toolbar-button');
		$button.addClass('ti-loading');

		TITestRunner.exec("runTestsInPath", fullExecPath, testCasePath).done(function (result) {
			$button.removeClass('ti-loading');
			lastTestResults = result;
			$(exports).trigger("updatedTestResults", result);
		}).fail(function (err) {
			$button.removeClass('ti-loading');
			TIUtils.log(err);
		});
	}

	function getLastTestResults () {
		return lastTestResults;
	}

	function getGeneratedTestCaseCollectionForPath (fullPath) {
		if (generatedTestCaseCollectionsByDocument[fullPath] === undefined) {
			if (! ProjectManager.isWithinProject(fullPath)) {
				TIUtils.log("Path not in project");
				return;
			}

			var specPath = _getSpecPath();
			if (specPath === undefined) {
				return;
			}

			var originalFileNameWithoutExtension = FileUtils.getBaseName(fullPath).split(".").slice(0,-1).join(".");
			var specName = autogeneratedPrefix + originalFileNameWithoutExtension;

			generatedTestCaseCollectionsByDocument[fullPath] = new GeneratedTestCaseCollection(specName, specPath);
		}

		return generatedTestCaseCollectionsByDocument[fullPath];
	}

	function getUserTestCaseCollections () {
		return userGeneratedTestCaseCollections;
	}
    
    function getUserTestCaseCollectionForName(name) {
        if (testCaseCollectionsByName[name] === undefined) {
            testCaseCollectionsByName[name] = new TestCaseCollection(name, _getSpecPath());
        }
        
        return testCaseCollectionsByName[name];
    }

	function _rescanTestCaseCollectins () {
		var specPath = _getSpecPath();
		var specDir = FileSystem.getDirectoryForPath(specPath);
		specDir.getContents(function (error, entries, stats, entryErrors) {
			for (var i = entries.length - 1; i >= 0; i--) {
				var entryPath = entries[i].fullPath;
				var entryName = FileUtils.getBaseName(entryPath);
				var entryMatch = entryName.match(/(.*)Spec\.js$/);
				if (entryMatch !== null) {
					var name = entryMatch[1];
					if (name.indexOf(autogeneratedPrefix)) {
						userGeneratedTestCaseCollections.push(name);
					}
				}
			}

			$(exports).trigger("updatedTestCollections");
		});
	}

	function _getSpecPath() {
		var projectRootDir = ProjectManager.getProjectRoot();
		if (! projectRootDir) {
			TIUtils.log("No project open.");
			return;
		}

		return projectRootDir.fullPath + "brackets_spec/";
	}

	function _onProjectOpen () {
		generatedTestCaseCollectionsByDocument = {};
        testCaseCollectionsByName = {};
		userGeneratedTestCaseCollections = [];
		_rescanTestCaseCollectins();
	}

	exports.init = init;
	exports.runTests = runTests;
	exports.getGeneratedTestCaseCollectionForPath = getGeneratedTestCaseCollectionForPath;
	exports.getUserTestCaseCollections = getUserTestCaseCollections; 
	exports.getUserTestCaseCollectionForName = getUserTestCaseCollectionForName; 
	exports.getLastTestResults = getLastTestResults;
});
