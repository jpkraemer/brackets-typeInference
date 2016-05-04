/*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, maxerr: 50 */
/*global define, $, brackets, Mustache */

define(function (require, exports, module) {
	"use strict"; 

	var _ 							= require("./src/lib/lodash");
	var AppInit						= brackets.getModule("utils/AppInit");
	var DocumentationInlineEditor 	= require("./src/DocumentationInlineEditor");
	var DocumentManger				= brackets.getModule("document/DocumentManager");
	var MainViewManager				= brackets.getModule("view/MainViewManager");
	var EditorManager				= brackets.getModule("editor/EditorManager");
	var ExtensionUtils				= brackets.getModule("utils/ExtensionUtils");
	var JSUtils						= brackets.getModule("language/JSUtils");
	var ScopeManagerExtensions 		= require("./src/ScopeManagerExtensions");
	var SessionExtensions 			= require("./src/SessionExtensions");
	var TestCasesPane				= require("./src/TestCasesPane");
	var TestCaseCollectionManager	= require("./src/TestCaseCollectionManager");
	var TheseusAgentWrapper 		= require("./src/TheseusAgentWrapper");
	var TheseusTypeProvider 		= require("./src/TheseusTypeProvider");
	var TypeInformationCollection 	= require("./src/TypeInformationCollection");
	var FunctionTracker 			= require("./src/FunctionTracker");
	var TIUtils 					= require("./src/TIUtils");

	var EVENT_NAMESPACE = ".type-inference-main";

	var inlineWidgetsByFunctionIdentifier = {};
	var currentDocument; 
	var hostEditor;
	var testCasesPane;

	function _init () {
		TIUtils.log("loading... "); 

		ExtensionUtils.loadStyleSheet(module, "main.less");

		TheseusTypeProvider.init();
		TestCaseCollectionManager.init();

		//initialize overwrites
		ScopeManagerExtensions.init();
		SessionExtensions.init();

		// $(DocumentManger).on("currentDocumentChange", _currentDocumentChange);
		$(MainViewManager).on("currentFileChange", _currentDocumentChange);
		_currentDocumentChange(null, DocumentManger.getCurrentDocument());

		testCasesPane = new TestCasesPane();
	}

	/**
	 * Currently we set inline editors up here. This might move, not sure yet what's the best place
	 * @param  {jQuery Event} evt
	 * @param  {Document} currentDocument
	 * @param  {Document} previousDocument
	 */
	function _currentDocumentChange (evt, newCurrentDocument, previousDocument) {
		newCurrentDocument = DocumentManger.getCurrentDocument();
		if (currentDocument === newCurrentDocument) {
			return;
		}

		if (currentDocument) {
			$(currentDocument.typeInformationCollection).off(EVENT_NAMESPACE);
		}

		_.forOwn(inlineWidgetsByFunctionIdentifier, function (editor) {
			editor.close();
		});
		inlineWidgetsByFunctionIdentifier = {};

		if (hostEditor !== undefined) { 
			hostEditor._codeMirror.off("keydown", _onEditorKeyEvent);
		}

		currentDocument = newCurrentDocument;

		if (!currentDocument || currentDocument.getLanguage().getMode() !== "javascript") {
			return; 
		}

		hostEditor = EditorManager.getCurrentFullEditor();
		hostEditor._codeMirror.on("keydown", _onEditorKeyEvent);

		$(currentDocument.typeInformationCollection).on("change" + EVENT_NAMESPACE, _updateWidgets);
		_updateWidgets();
	}

	function _updateWidgets (event) {
		var functionInfos = currentDocument.functionTracker.getAllFunctions();
		_.forOwn(functionInfos, function (functionInfo) {
			if (inlineWidgetsByFunctionIdentifier[functionInfo.functionIdentifier] === undefined) {
				if (functionInfo.commentRange !== undefined) {
					inlineWidgetsByFunctionIdentifier[functionInfo.functionIdentifier] = new DocumentationInlineEditor(functionInfo.functionIdentifier, hostEditor, functionInfo.commentRange.start, functionInfo.commentRange.end);
				} else {
					var firstFunctionLine = functionInfo.functionRange.start.line;
					inlineWidgetsByFunctionIdentifier[functionInfo.functionIdentifier] = new DocumentationInlineEditor(functionInfo.functionIdentifier, hostEditor, { line: firstFunctionLine - 1, ch: 0 }, { line: firstFunctionLine - 1, ch: 0 });
				}
			}
		});

		var functionIdentifersWithWidgets = _.keys(inlineWidgetsByFunctionIdentifier);
		_.forEach(functionIdentifersWithWidgets, function (key) {
			if (_.map(functionInfos, "functionIdentifier").indexOf(key) === -1) {
				inlineWidgetsByFunctionIdentifier[key].close();
				delete inlineWidgetsByFunctionIdentifier[key];
			}
		});
	}

    function _onEditorKeyEvent (theEditor, event) { 	
        //sanity checks
        if ((event.type !== "keydown") || (theEditor !== EditorManager.getCurrentFullEditor()._codeMirror)) {
            TIUtils.log("_onEditorKeyEvent in main.js callback called with invalid event or unknown editor");
            return;
        }

        var cursorPos = theEditor.getCursor();
        var inlineWidget; 
        var fromBelow;

        switch (event.keyCode) {
            case 38: 
                //Arrow Key Up
     			inlineWidget = _.find(inlineWidgetsByFunctionIdentifier, function (inlineWidget) {
     				return (inlineWidget.info.cm.lineInfo(inlineWidget.info.line).line === cursorPos.line);
     			});
     			fromBelow = true;
                break;
            case 40:
                //Arrow Key Down
                inlineWidget = _.find(inlineWidgetsByFunctionIdentifier, function (inlineWidget) {
     				var range = inlineWidget.getCurrentRange(); 
     				return (range.start.line === cursorPos.line + 1);
     			});
     			fromBelow = false;
                break;
        }

        if (inlineWidget !== undefined) {
			inlineWidget.focus(fromBelow);
		}
    }

	AppInit.appReady(_init);

	exports.version = JSON.parse(require("text!package.json")).version;
});