/*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, maxerr: 50 */
/*global define, $, brackets, Mustache */

define(function (require, exports, module) {
	"use strict"; 

	var _ 						= require("./lib/lodash");
	var DocumentManager 		= brackets.getModule("document/DocumentManager");
	var Esprima					= require("./node/node_modules/esprima/esprima");
	var File 					= brackets.getModule("filesystem/File");
	var FileSystem				= brackets.getModule("filesystem/FileSystem");
	var ProjectManager 			= brackets.getModule("project/ProjectManager");
	var TIUtils					= require("./TIUtils");

	var testCaseFilesForProject = {};
	var testCasesForProject = {};

	function init () {
		$(ProjectManager).on("projectOpen", _onProjectOpen); 
	}

	function _onProjectOpen () {
		testCaseFilesForProject = {};

		ProjectManager.getAllFiles(function (element) {
			return (element instanceof File);
		}).done(function (files) {
			var storeTestCaseFile = function (file, testCaseFile) {
				testCaseFilesForProject[file.fullPath] = testCaseFile; 
			}; 

			for (var i = 0; i < files.length; i++) {
				var file = files[i];
				if ((file.fullPath.match(/\.js$/) !== null) && (file.fullPath.match(/^testFor_/) === null)) {
					var pathComponents = file.fullPath.split("/");
					var path = pathComponents.slice(0,-1).join("/");
					var match = _.last(pathComponents).match(/^(.*)\.js$/);
					var testFileName = "testFor_" + match[1] + ".js";
					var testFile = _.find(files, { fullPath: path + "/" + testFileName });

					if (testFile !== undefined) {
						storeTestCaseFile(file, testFile);
					} else {
						ProjectManager.createNewItem(path, testFileName, true).done(storeTestCaseFile.bind(null, file)); 
					}
				}
			}
		});
	}

	function _reindexTestFiles () {
		_.forOwn(testCaseFilesForProject, function (testCaseFile, filePath) {
			DocumentManager.getDocumentText(testCaseFile).done(function (testSourceCode) {
				
				var testSourceCodeLines = testSourceCode.split("\n");

				try {
					var testAst = Esprima.parse(testSourceCode, {
						attachComment: true, 
						loc: true, 
						tolerant: true
					});

					testAst = testAst.body.arguments.body.body; 

					var testCasesByFunctionIdentifier = {};
					_.forEach(testAst, function (node) {
						if ((node.type === "ExpressionStatement") && 
							(node.expression.type === "CallExpression") &&
							(node.expression.callee.name === "describe")) {

							var functionIdentifier = node.expression.arguments[0].value;
							testCasesByFunctionIdentifier[functionIdentifier] = [];
							var individualTestsAst = node.expression.arguments[1].body.body; 

							_.forEach(individualTestsAst, function (node) {
								if ((node.type === "ExpressionStatement") && 
									(node.expression.type === "CallExpression") &&
									(node.expression.callee.name === "it")) {

									var testFunctionLocaton = node.expression.arguments[1].loc; 
									var testFunctionLines = testSourceCodeLines.slice(testFunctionLocaton.start.line - 1, testFunctionLocaton.end.line - 1);
									testFunctionLines[0] = testFunctionLines[0].substr(testFunctionLocaton.start.ch); 
									testFunctionLines[testFunctionLines.length - 1] = testSourceCodeLines[testFunctionLines.length - 1].substr(0, testFunctionLocaton.end.ch);

									var testCaseId = node.expression.leadingComments[0].value; 
									var testCaseIdMatches = testCaseId.match(/@testId (\S+)/); 
									testCaseId = matches[1];

									var testCase = {
										id: testCaseId,
										title: node.expression.arguments[0].value,
										testFunction: testFunctionLines.join("\n")
									};
								}
							});
						}
					});

					testCasesForProject[filePath] = testCasesByFunctionIdentifier; 
				} catch (e) {
					TIUtils.log("Invalid contents of generated test file.");
					throw e;
				}
			});
		});
	}

	function getTestCasesForFunctionIdentifier (functionIdentifier) {
		return _.merge.apply(null, _.map(testCasesForProject))[functionIdentifier];
	}

	function getTestCaseForFunctionIdentifierAndTestCaseId (functionIdentifier, testCaseId) {
		return _.find(getTestCasesForFunctionIdentifier(functionIdentifier), { name: testCaseId }); 
	}

	function addTestCaseForFunctionIdentifier (functionIdentifier, fullPath, testCase) {
		if (getTestCaseForFunctionIdentifierAndTestCaseId(functionIdentifier, testCase.id) !== undefined) {
			TIUtils.log("Test Case with id: " + testCase.id + "already exists for function identifier: "+ functionIdentifier); 
			return;
		}

		var testCasesForPath = testCasesForProject[fullPath]; 
		if (testCasesForPath === undefined) {
			testCasesForPath = {};
			testCasesForProject[fullPath] = testCasesForPath; 
		}

		var testCasesForFunctionIdentifier = testCasesForPath[functionIdentifier]; 
		if (testCasesForFunctionIdentifier === undefined) {
			testCasesForFunctionIdentifier = []; 
			testCasesForPath[functionIdentifier] = testCasesForFunctionIdentifier;
		}

		do {
			testCase.id = Math.random().toString(36).substr(2,10); 
		} while (_.find(testCasesForFunctionIdentifier, { id: testCase.id }) !== undefined); 

		testCasesForFunctionIdentifier.push(testCase);

		return testCase;
	}

	function updateTestCaseForFunctionIdentifier (functionIdentifier, newTestCase) {
		var testCase = getTestCaseForFunctionIdentifierAndTestCaseId(functionIdentifier, newTestCase.id);
		if (testCase === undefined) {
			throw new Error("Could not update test case, no test case exists for id " + newTestCase.id);
		} else { 
			_.assign(testCase, newTestCase);
		}
	}

});