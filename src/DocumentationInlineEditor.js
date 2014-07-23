/*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, maxerr: 50 */
/*global define, $, brackets, Mustache */

define(function (require, exports, module) {
	"use strict"; 

	var InlineWidget 			= brackets.getModule("editor/InlineWidget").InlineWidget;

	/**
	 * @constructor
	 */
	function DocumentationInlineEditor (startBookmark, endBookmark) {
		this._startBookmark 	= startBookmark; 
		this._endBookmark 		= endBookmark; 

		InlineWidget.call(this);
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
    };

    /**
     * @override
     * Perform sizing & focus once we've been added to Editor's DOM
     */
    DocumentationInlineEditor.prototype.onAdded = function () {
        DocumentationInlineEditor.prototype.parentClass.onAdded.apply(this, arguments);

        this.hostEditor.setInlineWidgetHeight(this, 100, true);
    };

    DocumentationInlineEditor.prototype.setContent = function (newContent) {
        this.$htmlContent.append(newContent);
    };

    module.exports = DocumentationInlineEditor;
});