/*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, maxerr: 50 */
/*global define, $, brackets, Mustache */

define(function (require, exports, module) {
	"use strict"; 

	var _ 						= require("./lib/lodash");
	var DocumentCommandHandlers	= brackets.getModule("document/DocumentCommandHandlers");
	var DocumentManager 		= brackets.getModule("document/DocumentManager");
	var Esprima					= require("./node/node_modules/esprima/esprima");
	var Escodegen				= require("./lib/escodegen");
	var ExtensionUtils 			= brackets.getModule("utils/ExtensionUtils");
	var File 					= brackets.getModule("filesystem/File");
	var FileSystem				= brackets.getModule("filesystem/FileSystem");
	var FileUtils				= brackets.getModule("file/FileUtils");
	var NodeDomain 				= brackets.getModule("utils/NodeDomain");
	var ProjectManager 			= brackets.getModule("project/ProjectManager");
	var TITestRunner			= new NodeDomain("TITestRunner", ExtensionUtils.getModulePath(module, "node/TITestRunnerDomain"));
	var TIUtils					= require("./TIUtils");

	var testCasesForCurrentDocument = {};
	var SEPARATOR = "$$";

	function init () {
		$(DocumentManager).on("currentDocumentChange", _currentDocumentChanged); 
		_currentDocumentChanged();

		var $button = $("<a />").attr({
			id: "ti-runTests-toolbar-button",
			href: "#"
		}); 
		$button.on("click", runTests);
		$('#main-toolbar .buttons').append($button); 
	}

	function _currentDocumentChanged () {
		testCasesForCurrentDocument = {};

		var currentDocument = DocumentManager.getCurrentDocument(); 
		var testCaseFile = _getTestCaseFileForPath(currentDocument.file.fullPath);

		_parseTestFromFile(testCaseFile).done(function (testCasesByFunctionIdentifier) {
			testCasesForCurrentDocument = testCasesByFunctionIdentifier;
			$(exports).trigger("didLoadTestsForCurrentDocument");
		});
	}

	function _getTestCaseFileForPath (fullPath, createIfNecessary) {
		var specDir; 

		if (ProjectManager.isWithinProject(fullPath)) {
			//use project wide path
			var projectRootDir = ProjectManager.getProjectRoot(); 
			specDir = FileSystem.getDirectoryForPath(projectRootDir.fullPath + "brackets_spec/");
		} else {
			var parentPath = FileUtils.getDirectoryPath(fullPath);
			specDir = FileSystem.getDirectoryForPath(parentPath);
		}

		var originalFileNameWithoutExtension = FileUtils.getBaseName(fullPath).split(".").slice(0,-1).join(".");
		var testCaseFile = FileSystem.getFileForPath(specDir.fullPath + originalFileNameWithoutExtension + "Spec.js");

		if (createIfNecessary) {
			var result = $.Deferred();

			specDir.create(function (err, done) {
				testCaseFile.write("", function (err, done) {
					result.resolve(testCaseFile);
				});
			});

			return result.promise();
		} else {
			return testCaseFile;
		}
	}

	function _parseTestFromFile (file) {
		var result = $.Deferred();

		DocumentManager.getDocumentText(file).done(function (testSourceCode) {
		
			var extractCodeFromLocation = function (node, location) {
				var lines = testSourceCodeLines.slice(location.start.line - 1, location.end.line);
				lines[0] = lines[0].substr(location.start.column); 
				for (var i = 1; i < lines.length - 1; i++) {
					if (/^\s*$/.test(lines[i].substr(0, node.loc.start.column))) {
						lines[i] = lines[i].substr(node.loc.start.column);
					}
				}
				lines[lines.length - 1] = lines[lines.length - 1].substr(0, location.end.column);
				if (/^\s*$/.test(lines[lines.length - 1].substr(0, node.loc.start.column))) {
					lines[lines.length - 1] = lines[lines.length - 1].substr(node.loc.start.column);
				}

				return lines.join("\n");
			};

			var testSourceCodeLines = testSourceCode.split("\n");
			var testSuites = {}; 

			try {
				var testAst = Esprima.parse(testSourceCode, {
					attachComment: true, 
					loc: true, 
					tolerant: true
				});

				testAst = testAst.body;

				_.forEach(testAst, function (node) {
					if ((node.type === "ExpressionStatement") && 
						(node.expression.type === "CallExpression") &&
						(node.expression.callee.name === "describe")) {

						var functionIdentifier = node.expression.arguments[0].value;
						testSuites[functionIdentifier] = {
							tests: []
						};
						var individualTestsAst = node.expression.arguments[1].body.body; 

						_.forEach(individualTestsAst, function (node) {
							var i;

							if ((node.type === "ExpressionStatement") && (node.expression.type === "CallExpression")) {
								if (node.expression.callee.name === "it") {
									var testFunctionLocation = node.expression.arguments[1].loc; 
									var testFunctionLines = testSourceCodeLines.slice(testFunctionLocation.start.line - 1, testFunctionLocation.end.line);
									testFunctionLines[0] = testFunctionLines[0].substr(testFunctionLocation.start.column); 
									for (i = 1; i < testFunctionLines.length - 1; i++) {
										if (/^\s*$/.test(testFunctionLines[i].substr(0, node.loc.start.column))) {
											testFunctionLines[i] = testFunctionLines[i].substr(node.loc.start.column);
										}
									}
									testFunctionLines[testFunctionLines.length - 1] = testFunctionLines[testFunctionLines.length - 1].substr(0, testFunctionLocation.end.column);
									if (/^\s*$/.test(testFunctionLines[testFunctionLines.length - 1].substr(0, node.loc.start.column))) {
										testFunctionLines[testFunctionLines.length - 1] = testFunctionLines[testFunctionLines.length - 1].substr(node.loc.start.column);
									}

									var literalTestCaseNameComponents = node.expression.arguments[0].value.split(SEPARATOR);

									var testCase = {
										id: literalTestCaseNameComponents[0],
										functionIdentifier: functionIdentifier,
										title: literalTestCaseNameComponents.slice(1).join(SEPARATOR),
										code: extractCodeFromLocation(node, node.expression.arguments[1].loc)
									};

									testSuites[functionIdentifier].tests.push(testCase);
								} else if (node.expression.callee.name === "beforeEach") {
									testSuites[functionIdentifier].beforeEach = {
										code: extractCodeFromLocation(node, node.expression.arguments[0].loc)
									};
								} else if (node.expression.callee.name === "afterEach") {
									testSuites[functionIdentifier].afterEach = {
										code: extractCodeFromLocation(node, node.expression.arguments[0].loc)
									};
								}
							}
						});
					}
				});

				result.resolve(testSuites);
			} catch (e) {
				TIUtils.log("Invalid contents of generated test file.");
				throw e;
			}
		});

		return result.promise();
	}

	function _reindexTestFiles () {
		_.forOwn(testCaseFilesForProject, function (testCaseFile, filePath) {
			
		});
	}

	function _saveTestCases () {
		var resultAst = {
		    type: "Program",
		    body: _.map(testCasesForCurrentDocument, function (testSuite, functionIdentifier) {
				var result = {
		            type: "ExpressionStatement",
		            expression: {
		                type: "CallExpression",
		                callee: {
		                    type: "Identifier",
		                    name: "describe"
		                },
		                arguments: [
		                    {
		                        type: "Literal",
		                        value: functionIdentifier,
		                    },
		                    {
		                        type: "FunctionExpression",
		                        id: null,
		                        params: [],
		                        defaults: [],
		                        body: {
		                            type: "BlockStatement",
		                            body: _.map(testSuite.tests, function (testCase) {
						        		return {
							            type: "ExpressionStatement",
							            expression: {
							                type: "CallExpression",
							                callee: {
							                    type: "Identifier",
							                    name: "it"
							                },
							                arguments: [
							                    {
							                        type: "Literal",
							                        value: testCase.id + SEPARATOR + testCase.title,
							                    },
							                    {
						                        	type: "Literal",
						                        	xVerbatimProperty: {
						                            	content: testCase.code || "",
						                            	precedence: Escodegen.Precedence.Primary
						                            }
							                    }
							                ]
							            }
							        };})
		                        },
		                        rest: null,
		                        generator: false,
		                        expression: false
		                    }
		                ]
		            }
		        };

		        if (testSuite.beforeEach) {
					result.expression.arguments[1].body.push({
						type: "ExpressionStatement",
						expression: {
							type: "CallExpression",
							callee: {
								type: "Identifier",
								name: "beforeEach"
							},
							arguments: [
							{
								type: "Literal",
								xVerbatimProperty: {
									content: testSuite.beforeEach.code || "",
									precedence: Escodegen.Precedence.Primary
								}
							}
							]
						}
					});
		        }
		        
		        if (testSuite.afterEach) {
					result.expression.arguments[1].body.push({
						type: "ExpressionStatement",
						expression: {
							type: "CallExpression",
							callee: {
								type: "Identifier",
								name: "beforeEach"
							},
							arguments: [
							{
								type: "Literal",
								xVerbatimProperty: {
									content: testSuite.afterEach.code || "",
									precedence: Escodegen.Precedence.Primary
								}
							}
							]
						}
					});
		        }
		        return result;
	        })
		};

		var code = Escodegen.generate(resultAst, { verbatim: "xVerbatimProperty", comment: true }); 

		_getTestCaseFileForPath(DocumentManager.getCurrentDocument().file.fullPath, true).done(function (file) {
			file.write(code);
		}); 
	}

	function runTests () {
		var testCaseFile = _getTestCaseFileForPath(DocumentManager.getCurrentDocument().file.fullPath);
		var testCaseDir = FileUtils.getDirectoryPath(testCaseFile.fullPath); 
		var jasminePath = ExtensionUtils.getModulePath(module, "node/node_modules/jasmine-node/lib/jasmine-node/cli.js");

		TITestRunner.exec("runTestsInPath", jasminePath, testCaseDir).done(function (result) {
			$(exports).trigger("updatedTestResults", result);
		}).fail(function (err) {
			TIUtils.log(err);
		}); 
	}

	function getTestCasesForFunctionIdentifier (functionIdentifier) {
		return testCasesForCurrentDocument[functionIdentifier];
	}

	function getTestCaseForFunctionIdentifierAndTestCaseId (functionIdentifier, testCaseId) {
		return _.find(getTestCasesForFunctionIdentifier(functionIdentifier), { id: testCaseId }); 
	}

	function addTestCaseForPath (testCase, fullPath) {
		if (getTestCaseForFunctionIdentifierAndTestCaseId(testCase.functionIdentifier, testCase.id) !== undefined) {
			TIUtils.log("Test Case with id: " + testCase.id + "already exists for function identifier: "+ testCase.functionIdentifier); 
			return;
		}

		var testCasesForFunctionIdentifier = testCasesForCurrentDocument[testCase.functionIdentifier]; 
		if (testCasesForFunctionIdentifier === undefined) {
			testCasesForFunctionIdentifier = []; 
			testCasesForCurrentDocument[testCase.functionIdentifier] = testCasesForFunctionIdentifier;
		}

		do {
			testCase.id = Math.random().toString(36).substr(2,10); 
		} while (_.find(testCasesForFunctionIdentifier, { id: testCase.id }) !== undefined); 

		testCasesForFunctionIdentifier.push(testCase);

		_saveTestCases();

		return testCase;
	}

	function updateTestCase (newTestCases) {
		if (! Array.isArray(newTestCases)) {
			newTestCases = [ newTestCases ];
		}

		for (var i = 0; i < newTestCases.length; i++) {
			var newTestCase = newTestCases[i];
			var testCase = getTestCaseForFunctionIdentifierAndTestCaseId(newTestCase.functionIdentifier, newTestCase.id);
			if (testCase === undefined) {
				throw new Error("Could not update test case, no test case exists for id " + newTestCase.id);
			} else { 
				_.assign(testCase, newTestCase);
			}
		}

		_saveTestCases();
	}

	exports.init = init;
	exports.getTestCasesForFunctionIdentifier = getTestCasesForFunctionIdentifier; 
	exports.getTestCaseForFunctionIdentifierAndTestCaseId = getTestCasesForFunctionIdentifier; 
	exports.addTestCaseForPath = addTestCaseForPath; 
	exports.updateTestCase = updateTestCase;
});