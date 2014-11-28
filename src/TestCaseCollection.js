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
	var TIUtils					= require("./TIUtils");

	var SEPARATOR = "$$";

	function TestCaseCollection(name, basePath) {
		this._testSuites = {};

		this.file = FileSystem.getFileForPath(basePath + name + "Spec.js");
		this._loadingPromise = $.Deferred();
		this._parseTestFromFile().done(function (newTestSuites) {
			this._testSuites = newTestSuites; 
			this._loadingPromise.resolve();
		}.bind(this));

		_.bindAll(this);
	}

	TestCaseCollection.prototype.constructor = TestCaseCollection; 

	TestCaseCollection.prototype.testSuiteTemplate = {
		title: "",
		tests: [], 
		beforeAll: {
			code: ""
		},
		beforeEach: {
			code: "function () {\n\n}"
		},
		afterEach: {
			code: "function () {\n\n}"
		}
	};

	TestCaseCollection.prototype.file = undefined; 
	TestCaseCollection.prototype._testSuites = undefined; 
	TestCaseCollection.prototype.loadingPromise = undefined; 

	Object.defineProperties(TestCaseCollection.prototype, {
		"testSuites": {
			get: function () { return this._testSuites; },
			set: function () { throw new Error("Cannot set testSuites, use dedicated modification methods."); }
		},
		"loadingPromise": {
			get: function () { return this._loadingPromise.promise(); },
			set: function () { throw new Error("Cannot set loadingPromise"); }
		}
	});

	TestCaseCollection.prototype.getTestSuiteTitlesById = function () {
		return _.mapValues(this.testSuites, "title");
	};

	TestCaseCollection.prototype.getTestSuiteForId = function (id) {
		return this.testSuites[id];
	};

	TestCaseCollection.prototype.newTestSuiteWithTitle = function(title) {
		var newSuiteId; 
		do {
			newSuiteId = Math.random().toString(36).substr(2,10); 
		} while (_.keys(this.testSuites).indexOf(newSuiteId) > -1); 


		this.testSuites[newSuiteId] = _.cloneDeep(this.testSuiteTemplate);
		this.testSuites[newSuiteId].id = newSuiteId;
		this.testSuites[newSuiteId].title = title;

		return this.testSuites[newSuiteId];
	};

	TestCaseCollection.prototype.getTestCaseForSuiteIdAndTestCaseId = function (id, testCaseId) {
		var suite = this.getTestSuiteForId(id); 
		var result;

		if (suite !== undefined) {
			result = _.find(suite.tests, { id: testCaseId }); 
		}

		return result;
	};

	TestCaseCollection.prototype.addTestCaseToSuite = function (testCase, id) {
		if (this.getTestCaseForSuiteIdAndTestCaseId(id, testCase.id) !== undefined) {
			TIUtils.log("Test Case with id: " + testCase.id + "already exists for suite id: "+ id); 
			return;
		}

		var testSuite = this.getTestSuiteForId(id);

		testCase.suiteId = id;
		do {
			testCase.id = Math.random().toString(36).substr(2,10); 
		} while (_.find(testSuite.tests, { id: testCase.id }) !== undefined); 

		testSuite.tests.push(testCase);

		return testCase;
	};

	TestCaseCollection.prototype.updateTestCaseInSuite = function (newTestCases, id) {
		if (! Array.isArray(newTestCases)) {
			newTestCases = [ newTestCases ];
		}

		for (var i = 0; i < newTestCases.length; i++) {
			var newTestCase = newTestCases[i];
			var testCase = this.getTestCaseForSuiteIdAndTestCaseId(id, newTestCase.id);
			if (testCase === undefined) {
				throw new Error("Could not update test case, no test case exists for id " + newTestCase.id);
			} else { 
				_.assign(testCase, newTestCase);
			}
		}
	};

	TestCaseCollection.prototype.updateTestSuite = function (testSuite) {
		this._testSuites[testSuite.id] = testSuite; 
	};

	TestCaseCollection.prototype._parseTestFromFile = function () {
		var result = $.Deferred();

		DocumentManager.getDocumentText(this.file).done(function (testSourceCode) {
			result.resolve(this._parseTestFromCode(testSourceCode));
		}.bind(this)).fail(function (err) {
			if (err === "NotFound") {
				//happens for newly created files that do not yet exist on disk
				result.resolve({});
			}
		});

		return result.promise();
	};

	TestCaseCollection.prototype._parseTestFromCode = function(testSourceCode) {
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

					var suiteNameComponents = node.expression.arguments[0].value.split(SEPARATOR);
					var suiteId = suiteNameComponents[0];
					var suiteName = suiteNameComponents.slice(1).join(SEPARATOR);

					testSuites[suiteId] = _.cloneDeep(this.testSuiteTemplate);
					testSuites[suiteId].id = suiteId;
					testSuites[suiteId].title = suiteName;

					var individualTestsAst = node.expression.arguments[1].body.body; 
					var beforeAllNodes = [];
					var foundFirstJasmineNode = false;

					_.forEach(individualTestsAst, function (node) {
						var i;

						if ((node.type === "ExpressionStatement") && (node.expression.type === "CallExpression")) {
							if (node.expression.callee.name === "it") {
								foundFirstJasmineNode = true;

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
									suiteId: suiteId,
									title: literalTestCaseNameComponents.slice(1).join(SEPARATOR),
									code: extractCodeFromLocation(node, node.expression.arguments[1].loc),
									sourceLocation: node.expression.arguments[1].loc
								};

								testSuites[suiteId].tests.push(testCase);
							} else if (node.expression.callee.name === "beforeEach") {
								foundFirstJasmineNode = true;
								testSuites[suiteId].beforeEach.code = extractCodeFromLocation(node, node.expression.arguments[0].loc);
							} else if (node.expression.callee.name === "afterEach") {
								foundFirstJasmineNode = true;
								testSuites[suiteId].afterEach.code = extractCodeFromLocation(node, node.expression.arguments[0].loc);
							}
						} else if (! foundFirstJasmineNode) {
							beforeAllNodes.push(node);
						}
					});

					testSuites[suiteId].beforeAll.code = Escodegen.generate({
						type: "Program",
						body: beforeAllNodes
					});
				}
			}.bind(this));
		} catch (e) {
			TIUtils.log("Invalid contents of generated test file.");
			throw e;
		}

		return testSuites;
	};

	TestCaseCollection.prototype.save = function () {
		var resultPromise = new $.Deferred();
		var resultAst = {
		    type: "Program",
		    body: _.map(this.testSuites, this._generateAstForSuite)
		};

		var code = Escodegen.generate(resultAst, { verbatim: "xVerbatimProperty", comment: true }); 

		this.file.write(code, function () {
			resultPromise.resolve();
		});

		this._testSuites = this._parseTestFromCode(code);

		return resultPromise.promise();
	};

	TestCaseCollection.prototype._generateAstForSuite = function(testSuite) {
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
                        value: testSuite.id + SEPARATOR + testSuite.title,
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

        if (testSuite.beforeAll && testSuite.beforeAll.code) {
        	//escoden will add a ; after the expression statement, so we need to remove an existing one
        	testSuite.beforeAll.code = testSuite.beforeAll.code.trim();
        	if (testSuite.beforeAll.code.substr(-1) === ";") {
        		testSuite.beforeAll.code = testSuite.beforeAll.code.slice(0, -1);
        	}
        	result.expression.arguments[1].body.body.unshift({
        		type: "ExpressionStatement", 
        		expression: {
	        		type: "Literal",
	        		xVerbatimProperty: {
						content: testSuite.beforeAll.code || "",
						precedence: Escodegen.Precedence.Primary
					}
				}
        	});
        }

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
	};

	module.exports = TestCaseCollection;
});