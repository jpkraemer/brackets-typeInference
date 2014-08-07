/*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, maxerr: 50 */
/*global define, $, brackets, Mustache */

define(function (require, exports, module) {
	"use strict"; 

	var AppInit						= brackets.getModule("utils/AppInit");
	var DocumentationInlineEditor 	= require("./src/DocumentationInlineEditor");
	var DocumentManger				= brackets.getModule("document/DocumentManager");
	var EditorManager				= brackets.getModule("editor/EditorManager");
	var ExtensionUtils				= brackets.getModule("utils/ExtensionUtils");
	var FunctionTracker				= require("./src/FunctionTracker");
	var JSDocTypeProvider			= require("./src/JSDocTypeProvider");
	var JSUtils						= brackets.getModule("language/JSUtils");
	var TheseusTypeProvider 		= require("./src/TheseusTypeProvider");
	var TypeInformationStore 		= require("./src/TypeInformationStore"); 
	var TIUtils 					= require("./src/TIUtils");

	var inlineWidgetsByFunctionIdentifier = {};
	var currentDocument; 
	var hostEditor;

	function _init () {
		TIUtils.log("loading... "); 

		ExtensionUtils.loadStyleSheet(module, "main.less");

		TypeInformationStore.init();
		TheseusTypeProvider.init();
		JSDocTypeProvider.init();
		FunctionTracker.init();

		$(DocumentManger).on("currentDocumentChange", _currentDocumentChange);
		_currentDocumentChange(null, DocumentManger.getCurrentDocument());

		$(TypeInformationStore).on("didUpdateTypeInformation", _didUpdateTypeInformation); 
	}

	/**
	 * Currently we set inline editors up here. This might move, not sure yet what's the best place
	 * @param  {jQuery Event} evt
	 * @param  {Document} currentDocument
	 * @param  {Document} previousDocument
	 */
	function _currentDocumentChange (evt, newCurrentDocument, previousDocument) {
		currentDocument = newCurrentDocument;

		hostEditor = EditorManager.getCurrentFullEditor();

		if (currentDocument.getLanguage().getMode() !== "javascript") {
			return; 
		}

		TypeInformationStore.functionIdentifiersForFile(currentDocument.file.fullPath).done(function (functionIdentifiers) {
			var fullText = currentDocument.getText(); 
			var lines = fullText.split("\n");
			var regex = /@uniqueFunctionIdentifier (\S+)/; 

			for (var i = 0; i < lines.length; i++) {
				var line = lines[i];
				var match = regex.exec(line);
				if (match && (functionIdentifiers.indexOf(match[1]) !== -1)) {
					var functionIdentifier = match[1];
					var commentRange = _extractCommentPositionStartingAtLineWithLineArray(i, lines);

					inlineWidgetsByFunctionIdentifier[functionIdentifier] = new DocumentationInlineEditor(functionIdentifier, hostEditor, commentRange.startPos, commentRange.endPos);
				}
			}
		});
	}

	function _didUpdateTypeInformation (evt, newDoc) {
		if ((inlineWidgetsByFunctionIdentifier[newDoc.functionIdentifier] === undefined) && 
			(newDoc.file === currentDocument.file.fullPath)) {

			var fullText = currentDocument.getText(); 
			var lines = fullText.split("\n");

			for (var i = 0; i < lines.length; i++) {
				var line = lines[i]; 

				var lineNumber = line.indexOf("@uniqueFunctionIdentifier " + newDoc.functionIdentifier);
				if (lineNumber !== -1) {
					var commentRange = _extractCommentPositionStartingAtLineWithLineArray(lineNumber, lines);
					inlineWidgetsByFunctionIdentifier[newDoc.functionIdentifier] = new DocumentationInlineEditor(newDoc.functionIdentifier, hostEditor, commentRange.startPos, commentRange.endPos);
				}
			}
		}
	}

	function _extractCommentPositionStartingAtLineWithLineArray (lineNumber, lines) {
		var startPos = {}; 
		var endPos = {}; 

		startPos.line = 0; 
		var i = lineNumber - 1; 
		while ((i >= 0) && (startPos.line === 0)) {
			if (/^\s*\/\*\*/.test(lines[i])) {
				startPos.line = i;
				startPos.ch = lines[i].match(/^\s*/)[0].length;
			}
			i--;
		}

		endPos.line = 0; 
		i = lineNumber + 1; 
		while ((i < lines.length) && (endPos.line === 0)) {
			if (/^\s*\*\//.test(lines[i])) {
				endPos.line = i;
				endPos.ch = lines[i].match(/^\s*\*\//)[0].length;
			}
			i++;
		}	

		return {
			startPos: startPos,
			endPos: endPos
		};
	}

	AppInit.appReady(_init);

	exports.version = JSON.parse(require("text!package.json")).version;
});