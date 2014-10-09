/*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, maxerr: 50 */
/*global define, $, brackets, Mustache */

define(function (require, exports, module) {
	"use strict"; 

	var _ 						= require("./lib/lodash");
	var Async					= brackets.getModule("utils/Async");
	var DocumentCommandHandlers	= brackets.getModule("document/DocumentCommandHandlers");
	var DocumentManager 		= brackets.getModule("document/DocumentManager");
	var Esprima					= require("./node/node_modules/esprima/esprima");
	var Escodegen				= require("./lib/escodegen");
	var File 					= brackets.getModule("filesystem/File");
	var FileSystem				= brackets.getModule("filesystem/FileSystem");
	var FileUtils				= brackets.getModule("file/FileUtils");
	var FunctionTracker			= require("./FunctionTracker");
	var TestCaseCollection 		= require("./TestCaseCollection");
	var TIUtils					= require("./TIUtils");

	var SEPARATOR = "$$";

	function GeneratedTestCaseCollection(name, basePath) {
		TestCaseCollection.call(this, name, basePath);

		_.bindAll(this);
	}

	GeneratedTestCaseCollection.prototype = Object.create(TestCaseCollection.prototype); 
	GeneratedTestCaseCollection.prototype.constructor = GeneratedTestCaseCollection; 

	GeneratedTestCaseCollection.prototype.getTestSuiteForTitle = function (title, createIfNecessary) {
		if (createIfNecessary === undefined) {
			createIfNecessary = false;
		}

		if ((createIfNecessary) && (this.testSuites[title] === undefined)) {
			var functionName = this._functionNameFromFunctionIdentifier(title);

			var newSuite = _.cloneDeep(this.testSuiteTemplate);
			newSuite.title = title; 
			newSuite.beforeEach.code = "function () {\n    " + functionName + " = " + this._functionCodeVariableNameForFunctionName(functionName) + ";\n}";
			newSuite.beforeAll.code = "var " + functionName + ";";
			this.testSuites[title] = newSuite;
		}

		return this.testSuites[title];
	};

	GeneratedTestCaseCollection.prototype._functionNameFromFunctionIdentifier = function(functionIdentifier) {
		var functionIdentifierParts = functionIdentifier.split("-"); 
		return functionIdentifierParts[functionIdentifierParts.length - 2];
	};

	GeneratedTestCaseCollection.prototype._functionCodeVariableNameForFunctionName = function(functionName) {
		return "__" + functionName + "Code__";
	};

	GeneratedTestCaseCollection.prototype._generateAstForSuite = function (testSuite) {
		var result = TestCaseCollection.prototype._generateAstForSuite.call(this, testSuite);

		var resultPromise = new $.Deferred();

		var path = testSuite.title.split("-").slice(0,-3).join("-");
		var file = FileSystem.getFileForPath(path);
		DocumentManager.getDocumentText(file).done(function (code) {
			
			var functionRange = FunctionTracker.functionLocationForFunctionIdentifier(testSuite.title).functionRange;
			var codeLines = code.split("\n").slice(functionRange.start.line, functionRange.end.line + 1); 
			
			codeLines[0] = codeLines[0].substr(functionRange.start.ch); 
			var argumentsMatch = codeLines[0].match(/function.*?(\(.*?\))/);
			var argumentsString; 
			if (argumentsMatch !== null) {
				argumentsString = argumentsMatch[1];
			}
			codeLines[0] = codeLines[0].substr(codeLines[0].indexOf("{"));

			codeLines[codeLines.length - 1] = codeLines[codeLines.length - 1].substr(0, functionRange.end.ch);
			var functionCode = "var " + 
				this._functionCodeVariableNameForFunctionName(this._functionNameFromFunctionIdentifier(testSuite.title)) + 
				" = function " + 
				argumentsString +
				" " +
				codeLines.join("\n"); 

			result.expression.arguments[1].body.body.push({
	    		type: "ExpressionStatement", 
	    		expression: {
	        		type: "Literal",
	        		xVerbatimProperty: {
						content: functionCode,
						precedence: Escodegen.Precedence.Primary
					}
				}
	    	});

			resultPromise.resolve(result);
		}.bind(this));

		return resultPromise.promise();
	};

	GeneratedTestCaseCollection.prototype.save = function () {
		var resultAst = {
		    type: "Program",
		    body: []
		};

		var testSuitesCount = _.values(this.testSuites).length;
		var completedCount = 0; 

		 _.each(this.testSuites, function (testSuite) {
		 	this._generateAstForSuite(testSuite).done(function (suiteAst) {
		 		resultAst.body.push(suiteAst);
		 		
		 		completedCount++; 
		 		if (completedCount === testSuitesCount) {
		 			var code = Escodegen.generate(resultAst, { verbatim: "xVerbatimProperty", comment: true }); 

					this.file.write(code, function () {
						// _currentDocumentChanged();
					});
		 		}
		 	}.bind(this));
		 }.bind(this));		
	};

	module.exports = GeneratedTestCaseCollection;
});