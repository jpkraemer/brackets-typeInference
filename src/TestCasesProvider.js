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
	var TypeInformationStore	= require("./TypeInformationStore");

	var returnValueTestTemplate = require("text!./templates/returnValueTest.txt");
	var exceptionTestTemplate 	= require("text!./templates/exceptionTest.txt");

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
							title: node.expression.arguments[0].value,
							tests: [], 
							beforeEach: {
								code: "function () {\n\n}"
							},
							afterEach: {
								code: "function () {\n\n}"
							}
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
										code: extractCodeFromLocation(node, node.expression.arguments[1].loc),
										sourceLocation: node.expression.arguments[1].loc
									};

									testSuites[functionIdentifier].tests.push(testCase);
								} else if (node.expression.callee.name === "beforeEach") {
									testSuites[functionIdentifier].beforeEach.code = extractCodeFromLocation(node, node.expression.arguments[0].loc);
								} else if (node.expression.callee.name === "afterEach") {
									testSuites[functionIdentifier].afterEach.code = extractCodeFromLocation(node, node.expression.arguments[0].loc);
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

	function save () {
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
					result.expression.arguments[1].body.body.push({
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
					result.expression.arguments[1].body.body.push({
						type: "ExpressionStatement",
						expression: {
							type: "CallExpression",
							callee: {
								type: "Identifier",
								name: "afterEach"
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
			file.write(code, function () {
				_currentDocumentChanged();
			});
		}); 
	}

	/**
	 * This method generates suggested test cases based on a given type information 
	 * Note that the test cases suggested here are by design and not set in stone.
	 * @param  {TypeInformation} typeInformation 
	 * @return {[TestCase]}
	 */
	function suggestArgumentValues (typeInformation) {
		var result = []; 
		for (var i = 0; i < typeInformation.argumentTypes.length; i++) {
			var argumentType = typeInformation.argumentTypes[i]; 
			var argumentSuggestion = []; 

			switch (argumentType.type) {
				case "number": 
					argumentSuggestion = argumentSuggestion.concat([ 0, 1, -1, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY ]); 
					break; 
				case "string": 
					argumentSuggestion = argumentSuggestion.concat([ "", "testString" ]);
					break; 
				case "array":
					argumentSuggestion.push([]);
					if (_.isEmpty(argumentSuggestion.spec)) {
						argumentSuggestion.push([ 0, "a", 2, "b", 4, "c", 6, "d", 8, "e" ]); 
					} else if (argumentSuggestion.spec.length === 1) {
						switch (argumentSuggestion.spec[0].type) {
							case "string": 
								argumentSuggestion.push([ "a", "b", "c", "d", "e", "f" ]); 
								break; 
							case "number":
								argumentSuggestion.push([ 0, 1, 2, 3, 4, 5, 6, 7, 8, 9 ]);
								break;
						}
					}
					break;
				case "object":
					argumentSuggestion.push({});
					break; 
			}

			if (argumentType.optional === true) {
				argumentSuggestion.push(undefined);
			}

			result[i] = argumentSuggestion;
		}

		return result;
	}

	function runTests () {
		var testCaseFile = _getTestCaseFileForPath(DocumentManager.getCurrentDocument().file.fullPath);
		var testCaseDir = FileUtils.getDirectoryPath(testCaseFile.fullPath); 
		var jasminePath = ExtensionUtils.getModulePath(module, "node/node_modules/jasmine-node/lib/jasmine-node/cli.js");
		var nodeTheseusPath = ExtensionUtils.getModulePath(module, "node/node_modules/node-theseus/bin/node-theseus");
		var fullExecPath = nodeTheseusPath + " --theseus-port=8889 " + jasminePath;

		var $button = $('#main-toolbar .buttons #ti-runTests-toolbar-button'); 
		$button.addClass('ti-loading');

		TITestRunner.exec("runTestsInPath", fullExecPath, testCaseDir).done(function (result) {
			$button.removeClass('ti-loading');
			$(exports).trigger("updatedTestResults", result);
		}).fail(function (err) {
			$button.removeClass('ti-loading');
			TIUtils.log(err);
		}); 
	}

	function getTestSuggestionsForFunctionIdentifier (functionIdentifier) {
		var resultPromise = $.Deferred();
		var typeInformation = TypeInformationStore.typeInformationForFunctionIdentifier(functionIdentifier).done(function (docs) {
			var getTemplateStringForBaseTemplate = function (template) {
				var functionCall = functionName + "(";
				functionCall += typeInformation.argumentTypes.map(function(el, index) {
					return "__" + index + "__"; 
				}).join(", ");
				functionCall += ")";
				template = template.replace(/__name__/, functionCall); 
				return template;
			};

			if (docs.length === 0) {
				resultPromise.reject("No type information found");
			}

			var typeInformation = docs[0];

			var functionIdentifierSegments = typeInformation.functionIdentifier.split("-");
			var functionIndex = functionIdentifierSegments.lastIndexOf("function");
			var functionName = functionIdentifierSegments.slice(functionIndex + 1, -1).join("-");

			var result = []; 
			var argumentSuggestions = suggestArgumentValues(typeInformation);
			if (typeInformation.returnType !== undefined) {
				result.push({
					title: "should return correct result",
					templateString: getTemplateStringForBaseTemplate(returnValueTestTemplate),
					argumentSuggestions: argumentSuggestions
				});
			}

			result.push({
				title: "should not throw exception for valid input",
				templateString: getTemplateStringForBaseTemplate(exceptionTestTemplate),
				argumentSuggestions: argumentSuggestions
			});

			resultPromise.resolve(result);
		}); 

		return resultPromise.promise();		
	}

	function getTestSuiteForFunctionIdentifier (functionIdentifier) {
		return testCasesForCurrentDocument[functionIdentifier];
	}

	function getTestCaseForFunctionIdentifierAndTestCaseId (functionIdentifier, testCaseId) {
		return _.find(getTestSuiteForFunctionIdentifier(functionIdentifier).tests, { id: testCaseId }); 
	}

	function addTestCaseForPath (testCase, fullPath) {
		if (getTestCaseForFunctionIdentifierAndTestCaseId(testCase.functionIdentifier, testCase.id) !== undefined) {
			TIUtils.log("Test Case with id: " + testCase.id + "already exists for function identifier: "+ testCase.functionIdentifier); 
			return;
		}

		var testSuite = testCasesForCurrentDocument[testCase.functionIdentifier]; 
		if (testSuite === undefined) {
			testSuite = {
				tests: [], 
				beforeEach: {
					code: "function () {\n\n}"
				},
				afterEach: {
					code: "function () {\n\n}"
				}
			}; 
			testCasesForCurrentDocument[testCase.functionIdentifier] = testSuite;
		}

		do {
			testCase.id = Math.random().toString(36).substr(2,10); 
		} while (_.find(testSuite.tests, { id: testCase.id }) !== undefined); 

		testSuite.tests.push(testCase);

		// _saveTestCases();

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
	}

	exports.init = init;
	exports.getTestSuggestionsForFunctionIdentifier = getTestSuggestionsForFunctionIdentifier;
	exports.getTestSuiteForFunctionIdentifier = getTestSuiteForFunctionIdentifier; 
	exports.getTestCaseForFunctionIdentifierAndTestCaseId = getTestCaseForFunctionIdentifierAndTestCaseId; 
	exports.addTestCaseForPath = addTestCaseForPath; 
	exports.updateTestCase = updateTestCase;
	exports.save = save;
});