/*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, maxerr: 50 */
/*global define, $, brackets, Mustache */

define(function (require, exports, module) {
	"use strict"; 

	var InlineWidget 			       = brackets.getModule("editor/InlineWidget").InlineWidget;
    var TypeInformationHTMLRenderer    = require("./TypeInformationHTMLRenderer");
    var TypeInformationStore           = require("./TypeInformationStore");
    var TIUtils                        = require("./TIUtils");

	/**
	 * @constructor
     * @param {String} functionIdentifier The permanent identifier for the function whose documentation is rendered
     * @param {Editor} hostEditor 
     * @param {{line: number, ch: number}} startBookmark start of the function in the source code
     * @param {{line: number, ch: number}} endBookmark end of the function in the source code
	 */
	function DocumentationInlineEditor (functionIdentifier, hostEditor, startPos, endPos) {
        this.functionIdentifier = functionIdentifier;
		this._startBookmark 	= hostEditor._codeMirror.setBookmark(startPos); 
		this._endBookmark 		= hostEditor._codeMirror.setBookmark(endPos);

		InlineWidget.call(this);

        TypeInformationStore.typeInformationForFunctionIdentifer(this.functionIdentifier).done(function (docs) {
            if (docs.length === 0) {
                return;
            } else {
                var typeInformation = docs[0];
        
                this.load(hostEditor);
                this.updateTypeInformation(typeInformation);

                hostEditor.addInlineWidget({ line: startPos.line - 1, ch: 0 }, this, true);        

                $(TypeInformationStore).on("didUpdateTypeInformation", this._didUpdateTypeInformation.bind(this));
            }
        }.bind(this));
	}

	DocumentationInlineEditor.prototype = Object.create(InlineWidget.prototype);
	DocumentationInlineEditor.prototype.constructor = DocumentationInlineEditor;
	DocumentationInlineEditor.prototype.parentClass = InlineWidget.prototype;

	/**
     * Start of the range of code we're attached to; _startBookmark.find() may by null if sync is lost.
     * @type {!CodeMirror.Bookmark}
     */
    DocumentationInlineEditor.prototype._startBookmark = null;
    
    /**
     * End of the range of code we're attached to; _endBookmark.find() may by null if sync is lost or even
     * in some cases when it's not. Call getCurrentRange() for the definitive text range we're attached to.
     * @type {!CodeMirror.Bookmark}
     */
    DocumentationInlineEditor.prototype._endBookmark = null;

    /**
     * A div to hold the actual content of the widget
     * @type {jQueryObject}
     */
    DocumentationInlineEditor.prototype.$contentDiv = null;

    /**
     * The function identifier for which this widget displays information
     * @type {String}
     */
    DocumentationInlineEditor.prototype.functionIdentifier = null;

	/**
     * Returns the current text range of the color we're attached to, or null if
     * we've lost sync with what's in the code.
     * @return {?{start:{line:number, ch:number}, end:{line:number, ch:number}}}
     */
    DocumentationInlineEditor.prototype.getCurrentRange = function () {
        var start, end;
        
        start = this._startBookmark.find();
        if (!start) {
            return null;
        }
        
        end = this._endBookmark.find();
        if (!end) {
            end = { line: start.line };
        }
        
        // Even if we think we have a good end bookmark, we want to run the
        // regexp match to see if there's a valid match that extends past the bookmark.
		var i = start.line; 
		var matches, line;
		do {
			line = this.hostEditor.document.getLine(i);
			matches = line.match(/^\s*\*/);
			i++;			
		} while (matches);

		end = { line: i - 1 };
		line = this.hostEditor.document.getLine(end.line);
		matches = line.match(/^\s*\*\//);
		if (matches && (end.ch === undefined)) {
			end.ch = matches.index + matches[0].length;
			this._endBookmark.clear(); 
			this._endBookmark = this.hostEditor._codeMirror.setBookmark(end);
		}

        if (end.ch === undefined) {
            // We were unable to resync the end bookmark.
            return null;
        } else {
            return {start: start, end: end};
        }
    };

    /**
     * @override
     * @param {!Editor} hostEditor
     */
    DocumentationInlineEditor.prototype.load = function (hostEditor) {
        DocumentationInlineEditor.prototype.parentClass.load.apply(this, arguments);

        this.$contentDiv = $("<div />")
                                .addClass("ti-documentation-container")
                                .css("margin-left", $(hostEditor._codeMirror.display.gutters).width());
        this.$htmlContent.append(this.$contentDiv);
    };

    /**
     * @override
     * Perform sizing & focus once we've been added to Editor's DOM
     */
    DocumentationInlineEditor.prototype.onAdded = function () {
        DocumentationInlineEditor.prototype.parentClass.onAdded.apply(this, arguments);

        this.hostEditor.setInlineWidgetHeight(this, 100, true);
    };

    DocumentationInlineEditor.prototype._didUpdateTypeInformation = function(evt, newDoc) {
        if (newDoc.functionIdentifier === this.functionIdentifier) {
            this.updateTypeInformation(newDoc);
        }
    };

    DocumentationInlineEditor.prototype.updateTypeInformation = function (typeInformation) {
        if (this.functionIdentifier !== typeInformation.functionIdentifier) {
            TIUtils.log("Inline widget for functionIdentifier "  + 
                this.functionIdentifier + 
                " updated with information for function identifier " + 
                typeInformation.functionIdentifier + 
                ". Aborting update!");
        }

        this.$contentDiv.html(TypeInformationHTMLRenderer.typeInformationToHTML(typeInformation));
    };

    module.exports = DocumentationInlineEditor;
});