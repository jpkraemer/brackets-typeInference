/*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, maxerr: 50 */
/*global define, $, brackets, Mustache */

define(function (require, exports, module) {
	"use strict"; 

	var _ 						= require("./lib/lodash");
	var DocumentCommandHandlers	= brackets.getModule("document/DocumentCommandHandlers");
	var DocumentManager 		= brackets.getModule("document/DocumentManager");
	var Esprima					= require("./node/node_modules/esprima/esprima");
	var Escodegen				= require("./lib/escodegen");
	var File 					= brackets.getModule("filesystem/File");
	var FileSystem				= brackets.getModule("filesystem/FileSystem");
	var FileUtils				= brackets.getModule("file/FileUtils");
	var ProjectManager 			= brackets.getModule("project/ProjectManager");
	var TIUtils					= require("./TIUtils");

	var testCasesForCurrentDocument = {};

	function init () {
		$(DocumentManager).on("currentDocumentChange", _currentDocumentChanged); 
		_currentDocumentChanged();
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
				
			var testSourceCodeLines = testSourceCode.split("\n");
			var testCasesByFunctionIdentifier = {}; 

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
						testCasesByFunctionIdentifier[functionIdentifier] = [];
						var individualTestsAst = node.expression.arguments[1].body.body; 

						_.forEach(individualTestsAst, function (node) {
							if ((node.type === "ExpressionStatement") && 
								(node.expression.type === "CallExpression") &&
								(node.expression.callee.name === "it")) {

								var testFunctionLocation = node.expression.arguments[1].loc; 
								var testFunctionLines = testSourceCodeLines.slice(testFunctionLocation.start.line - 1, testFunctionLocation.end.line);
								testFunctionLines[0] = testFunctionLines[0].substr(testFunctionLocation.start.column); 
								for (var i = 1; i < testFunctionLines.length - 1; i++) {
									if (/^\s*$/.test(testFunctionLines[i].substr(0, node.loc.start.column))) {
										testFunctionLines[i] = testFunctionLines[i].substr(node.loc.start.column);
									}
								}
								testFunctionLines[testFunctionLines.length - 1] = testFunctionLines[testFunctionLines.length - 1].substr(0, testFunctionLocation.end.column);
								if (/^\s*$/.test(testFunctionLines[testFunctionLines.length - 1].substr(0, node.loc.start.column))) {
									testFunctionLines[testFunctionLines.length - 1] = testFunctionLines[testFunctionLines.length - 1].substr(node.loc.start.column);
								}


								var testCaseId = node.leadingComments[0].value; 
								var testCaseIdMatches = testCaseId.match(/@testId (\S+)/); 
								testCaseId = testCaseIdMatches[1];

								var testCase = {
									id: testCaseId,
									functionIdentifier: functionIdentifier,
									title: node.expression.arguments[0].value,
									code: testFunctionLines.join("\n")
								};

								testCasesByFunctionIdentifier[functionIdentifier].push(testCase);
							}
						});
					}
				});

				result.resolve(testCasesByFunctionIdentifier);
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
		var testCases = testCasesForCurrentDocument;
		var resultAst = {
		    type: "Program",
		    body: _.map(testCases, function (testCasesForFunctionIdentifier, functionIdentifier) {
				return {
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
	                            body: _.map(testCasesForFunctionIdentifier, function (testCase) {
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
						                        value: testCase.title,
						                    },
						                    {
						                        type: "FunctionExpression",
						                        id: null,
						                        params: [],
						                        defaults: [],
						                        body: {
						                        	type: "BlockStatement",
						                        	body: [],
						                        	xVerbatimProperty: {
						                            	content: testCase.code || "",
						                            	precedence: Escodegen.Precedence.Primary
						                            }
					                        	},
						                        rest: null,
						                        generator: false,
						                        expression: false
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
	        };})
		};

		var code = Escodegen.generate(resultAst, { verbatim: "xVerbatimProperty" }); 

		_getTestCaseFileForPath(DocumentManager.getCurrentDocument().file.fullPath, true).done(function (file) {
			file.write(code);
		}); 
		
		// file.exists(function (err, exists) {
		// 	if (!exists) {

		// 	}
		// });

		// var document = DocumentManager.getDocumentForPath(file.fullPath).done(function (document) {
		// 	document.setText(code); 
		// 	DocumentCommandHandlers.doSave(document);
		// }).fail(function (err) {
		// 	console.log(err);
		// });
	}

	function getTestCasesForFunctionIdentifier (functionIdentifier) {
		return testCasesForCurrentDocument[functionIdentifier];
	}

	function getTestCaseForFunctionIdentifierAndTestCaseId (functionIdentifier, testCaseId) {
		return _.find(getTestCasesForFunctionIdentifier(functionIdentifier), { name: testCaseId }); 
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

	function updateTestCaseForFunctionIdentifier (functionIdentifier, newTestCase) {
		var testCase = getTestCaseForFunctionIdentifierAndTestCaseId(functionIdentifier, newTestCase.id);
		if (testCase === undefined) {
			throw new Error("Could not update test case, no test case exists for id " + newTestCase.id);
		} else { 
			_.assign(testCase, newTestCase);
			_saveTestCases();
		}
	}

	exports.init = init;
	exports.getTestCasesForFunctionIdentifier = getTestCasesForFunctionIdentifier; 
	exports.getTestCaseForFunctionIdentifierAndTestCaseId = getTestCasesForFunctionIdentifier; 
	exports.addTestCaseForPath = addTestCaseForPath; 
	exports.updateTestCaseForFunctionIdentifier = updateTestCaseForFunctionIdentifier;
});