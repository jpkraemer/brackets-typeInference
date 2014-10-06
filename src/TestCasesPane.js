 /*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, maxerr: 50 */
/*global define, $, brackets, Mustache */

define(function (require, exports, module) {
	"use strict"; 

	var _ 							= require("./lib/lodash");
	var Resizer 					= brackets.getModule("utils/Resizer");
	var BeforeAfterWidget			= require("./BeforeAfterWidget");
	var CodeMirror 					= brackets.getModule("thirdparty/CodeMirror2/lib/codemirror");
	var DocumentManager 			= brackets.getModule("document/DocumentManager"); 
	var EditorManager				= brackets.getModule("editor/EditorManager");
	var FunctionTracker				= require("./FunctionTracker");
	var PreviousExecutionsWidget	= require("./PreviousExecutionsWidget");
	var TemplateWidget				= require("./TemplateWidget");
	var TestCasesProvider			= require("./TestCasesProvider");
	var TestCaseWidget				= require("./TestCaseWidget");
	var TIUtils						= require("./TIUtils");
	
	var EVENT_NAMESPACE = ".TestCasesPane"; 

	function TestCasesPane () {
		_.bindAll(this);

		this.widgetsBySuite = {};

		this.$pane = $(require("text!./templates/TestCasesPane.html"));
		this.$scollView = this.$pane.find('.ti-scrollView');
		Resizer.makeResizable(this.$pane.get(0), Resizer.DIRECTION_HORIZONTAL, "left");

		this.$pane.find('.ti-roundAddButton').on('click', this.addTestButtonClicked); 

		this.$pane.insertBefore('#editor-holder > .CodeMirror');
		$('#editor-holder > .CodeMirror').width("50%");

		//respond to events 
		$(DocumentManager).on("currentDocumentChange", this.currentDocumentChanged); 
		this.currentDocumentChanged(null, DocumentManager.getCurrentDocument());

		$(DocumentManager).on("documentSaved", this.documentSaved);

		$(TestCasesProvider).on("didLoadTestsForCurrentDocument", this._update);
	}

	TestCasesPane.prototype.constructor = TestCasesPane; 

	TestCasesPane.prototype.$pane = undefined;
	TestCasesPane.prototype.$scollView = undefined;
	TestCasesPane.prototype.codeMirror = undefined;
	TestCasesPane.prototype.currentFullEditor = undefined;
	TestCasesPane.prototype.functionIdentifier = undefined;
	TestCasesPane.prototype.widgetsBySuite = undefined;
	TestCasesPane.prototype.suggestionWidgets = undefined;
	TestCasesPane.prototype.previousExecutionsWidget = undefined;

	TestCasesPane.prototype.addTestButtonClicked = function(event) {
		this._insertNewTestcase({
			functionIdentifier: this.functionIdentifier,
			title: "This is a test case", 
			code: "function () {\n\n}",
			isSuggestion: false
		});
	};

	TestCasesPane.prototype.templateAddButtonClicked = function(event) {
		this._insertNewTestcase({
			functionIdentifier: this.functionIdentifier,
			title: event.target.title,
			code: event.target.code
		});
	};

	TestCasesPane.prototype.previousExecutionsAddButtonClicked = function(event, index) {
		this._insertNewTestcase({
			functionIdentifier: this.functionIdentifier, 
			title: event.target.title,
			code: event.target.codeForSuggestionIndex(index)
		});
	};

	TestCasesPane.prototype._insertNewTestcase = function(testCase) {
		var newWidget = new TestCaseWidget(TestCasesProvider.addTestCaseForPath(testCase, this.currentFullEditor.document.file.fullPath));

		var widgetsForSuite = this.widgetsBySuite[testCase.functionIdentifier]; 
		newWidget.insertBefore(widgetsForSuite[widgetsForSuite.length - 1].$container);

		widgetsForSuite.push(newWidget);
		
		if (event !== undefined) {
			event.stopPropagation();
		}
	};

	TestCasesPane.prototype.documentSaved = function(event, doc) {
		if (DocumentManager.getCurrentDocument() === doc) { 
			this.updateTestCases();
			TestCasesProvider.save();
		}
	};

	TestCasesPane.prototype.updateTestCases = function() {
		_.forEach(this.widgetsBySuite, function (widgetsForSuite, suiteTitle) {
			var testSuite = {
				title: 	suiteTitle, 
				tests: 	_(widgetsForSuite).filter(function (widget) {
							return ("testCase" in widget);
						}).map(function(widget) {
							return widget.testCase;
						}).value(),
				beforeAll: {},
				beforeEach: {},
				afterEach: {}
			};

			var beforeAllWidget = _.find(widgetsForSuite, { mode: "beforeAll" });
			var beforeEachWidget = _.find(widgetsForSuite, { mode: "before" });
			var afterEachWidget = _.find(widgetsForSuite, { mode: "after" });

			testSuite.beforeAll.code = beforeAllWidget !== undefined ? beforeAllWidget.code : "";
			testSuite.beforeEach.code = beforeEachWidget !== undefined ? beforeEachWidget.code : "";
			testSuite.afterEach.code = afterEachWidget !== undefined ? afterEachWidget.code : "";

			TestCasesProvider.updateTestSuite(testSuite);
		});
	};

	TestCasesPane.prototype.currentDocumentChanged = function(event, newDocument) {
		var newFullEditor = EditorManager.getCurrentFullEditor(); 

		if (this.currentFullEditor !== newFullEditor) {
			if (this.currentFullEditor !== undefined) {
				$(this.currentFullEditor).off(EVENT_NAMESPACE);
			}

			this.currentFullEditor = newFullEditor; 
			$(this.currentFullEditor).on("cursorActivity" + EVENT_NAMESPACE, this.cursorMoved);
			this.cursorMoved();
		}
	};

	TestCasesPane.prototype.cursorMoved = function(event) {
		var pos = this.currentFullEditor.getCursorPos();
		var newFunctionIdentifier = FunctionTracker.functionIdAtLocationInDocument(pos, this.currentFullEditor.document);
		if (this.functionIdentifier !== newFunctionIdentifier) {
			this.functionIdentifier = newFunctionIdentifier;
			this._update(); 
		}
	};

	TestCasesPane.prototype.cursorShouldMoveToOtherWidget = function(event, direction) {
		var emittingWidgetIndex = -1; 
		var emittingSuiteName;
		var emittingWidgetSuite = _.find(this.widgetsBySuite, function (widgetArray, suiteName) {
			var tmp = widgetArray.indexOf(event.target);
			if (tmp > -1) {
				emittingWidgetIndex = tmp; 
				emittingSuiteName = suiteName;
				return true;
			} else {
				return false;
			}
		});
		
		if (emittingWidgetIndex === -1) {
			TIUtils.log("cursorShouldMoveToOtherWidget event received from untracked widget");
			return; 
		}

		var nextWidget;
		var suites = _.keys(this.widgetsBySuite);
		var emittingSuiteIndex = suites.indexOf(emittingSuiteName);
		var nextSuite;

		if ((emittingWidgetIndex === 0) && 
			(emittingSuiteIndex !== 0) && 
			(direction === "up")) {

			nextSuite = this.widgetsBySuite[suites[emittingSuiteIndex - 1]]; 
			nextWidget = _.last(nextSuite);

		} else if (	(emittingWidgetIndex === emittingWidgetSuite.length - 1) && 
					(emittingSuiteIndex !== suites.length - 1) && 
					(direction === "down")) {

			nextSuite = this.widgetsBySuite[suites[emittingSuiteIndex + 1]];
			nextWidget = _.first(nextSuite);

		} else {
			var nextWidgetIndex = (direction === "up") ? emittingWidgetIndex - 1 : emittingWidgetIndex + 1; 
			nextWidget = emittingWidgetSuite[nextWidgetIndex];	
		}
		
		if ((nextWidget !== undefined) && (nextWidget.focus !== undefined)) {
			nextWidget.focus(direction);
		}
	};

	TestCasesPane.prototype._clear = function() {
		_.each(this.widgetsBySuite, function (widgetArray) {
			_.each(widgetArray, function (widget) {
				widget.remove();	
			});			
		}); 

		_.each(this.suggestionWidgets, function (widget) {
			widget.remove();
		});

		if (this.previousExecutionsWidget) {
			this.previousExecutionsWidget.remove(); 
			this.previousExecutionsWidget = undefined;
		}

		this.widgetsBySuite = {};
		this.suggestionWidgets = [];

		$(".ti-testSection").remove();
	};

	TestCasesPane.prototype._update = function() {
		this.updateTestCases();
		this._clear();

		var testSuite = TestCasesProvider.getTestSuiteForFunctionIdentifier(this.functionIdentifier);

		if (testSuite === undefined) {
			return;
		}

		var widgetsForCurrentSuite = [];
		this.widgetsBySuite[testSuite.title] = widgetsForCurrentSuite;

		var widget = new BeforeAfterWidget(testSuite.beforeAll.code, "beforeAll");
		$(widget).on("cursorShouldMoveToOtherWidget", this.cursorShouldMoveToOtherWidget);
		widget.insertBefore(this.$pane.find('.ti-roundAddButton'));
		widgetsForCurrentSuite.push(widget);

		widget = new BeforeAfterWidget(testSuite.beforeEach.code, "before");
		$(widget).on("cursorShouldMoveToOtherWidget", this.cursorShouldMoveToOtherWidget);
		widget.insertBefore(this.$pane.find('.ti-roundAddButton'));
		widgetsForCurrentSuite.push(widget);

		var testCases = [];
		if (testSuite && testSuite.tests) {
			testCases = testSuite.tests;
		}
		for (var i = 0; i < testCases.length; i++) {
			var testCase = testCases[i];
			widget = new TestCaseWidget(testCase); 
			$(widget).on("cursorShouldMoveToOtherWidget", this.cursorShouldMoveToOtherWidget);
			widget.insertBefore(this.$pane.find('.ti-roundAddButton')); 
			widgetsForCurrentSuite.push(widget);
		}

		widget = new BeforeAfterWidget(testSuite.afterEach.code, "after");
		$(widget).on("cursorShouldMoveToOtherWidget", this.cursorShouldMoveToOtherWidget);
		widget.insertBefore(this.$pane.find('.ti-roundAddButton'));
		widgetsForCurrentSuite.push(widget);

		$("<div />").addClass('ti-testSection')
			.append($("<h2 />").text("From Last Execution"))
			.append($("<span />").text("The template below can be autofilled with values from calls to the function traced by Theseus. The test can be fully customized after adding it to the test suite."))
			.insertBefore(this.$pane.find(".ti-roundAddButton"));

		widget = new PreviousExecutionsWidget(this.functionIdentifier);
		$(widget).on("addButtonClicked", this.previousExecutionsAddButtonClicked); 
		widget.insertBefore(this.$pane.find('.ti-roundAddButton'));
		this.previousExecutionsWidget = widget;

		TestCasesProvider.getTestSuggestionsForFunctionIdentifier(this.functionIdentifier).done(function (testCaseSuggestions) {
			this.suggestionWidgets = []; 
			if (testCaseSuggestions.length > 0) {
				$("<div />").addClass('ti-testSection')
					.append($("<h2 />").text("Suggestions"))
					.append($("<span />").text("These templates can be prefilled with typical test data for your types and fully customized after adding them to the test suite."))
					.insertBefore(this.$pane.find(".ti-roundAddButton"));
			}	

			for (i = 0; i < testCaseSuggestions.length; i++) {
				var suggestion = testCaseSuggestions[i];
				widget = new TemplateWidget(suggestion.templateString, suggestion.argumentSuggestions); 
				widget.title = suggestion.title;
				$(widget).on("addButtonClicked", this.templateAddButtonClicked);
				widget.insertBefore(this.$pane.find('.ti-roundAddButton'));
				this.suggestionWidgets.push(widget);
			}
		}.bind(this));
	};

	module.exports = TestCasesPane;  
});