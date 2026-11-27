"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection } from "@codemirror/view";
import { Compartment, EditorState } from "@codemirror/state";
import { html as htmlLang } from "@codemirror/lang-html";
import { autocompletion, completionKeymap, type Completion, type CompletionContext } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, foldGutter, foldKeymap, HighlightStyle, indentOnInput, syntaxHighlighting } from "@codemirror/language";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { tags } from "@lezer/highlight";

export interface EditorVariableOption {
  name: string;
  group: "core" | "report" | "fragment";
  sample?: string;
  description?: string;
}

export interface TemplateCodeEditorHandle {
  insertText(text: string): void;
  focus(): void;
}

interface TemplateCodeEditorProps {
  value: string;
  onChange: (next: string) => void;
  variables: EditorVariableOption[];
  testId?: string;
  onFocus?: () => void;
  onBlur?: () => void;
}

const argusTheme = EditorView.theme({
  "&": {
    backgroundColor: "hsl(var(--surface))",
    color: "hsl(var(--fg))",
    fontSize: "12px",
    fontFamily: "var(--font-mono), ui-monospace, SFMono-Regular, Menlo, monospace",
    height: "440px",
  },
  ".cm-scroller": {
    overflow: "auto",
    lineHeight: "1.55",
  },
  ".cm-content": {
    padding: "10px 0",
    caretColor: "hsl(var(--primary))",
  },
  ".cm-gutters": {
    backgroundColor: "hsl(var(--surface-2) / 0.5)",
    color: "hsl(var(--fg-muted) / 0.7)",
    borderRight: "1px solid hsl(var(--border) / 0.5)",
    fontSize: "11px",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "hsl(var(--surface-2))",
    color: "hsl(var(--fg))",
  },
  ".cm-activeLine": {
    backgroundColor: "hsl(var(--surface-2) / 0.45)",
  },
  "&.cm-focused .cm-cursor": {
    borderLeftColor: "hsl(var(--primary))",
  },
  "&.cm-focused .cm-selectionBackground, ::selection": {
    backgroundColor: "hsl(var(--primary) / 0.22)",
  },
  ".cm-tooltip": {
    backgroundColor: "hsl(var(--surface-elevated))",
    border: "1px solid hsl(var(--border))",
    borderRadius: "8px",
    boxShadow: "0 10px 30px rgba(0, 0, 0, 0.28)",
    color: "hsl(var(--fg))",
    overflow: "hidden",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul": {
    fontFamily: "var(--font-mono), ui-monospace, monospace",
    fontSize: "11px",
    maxHeight: "240px",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "hsl(var(--primary) / 0.2)",
    color: "hsl(var(--fg))",
  },
  ".cm-completionDetail": {
    color: "hsl(var(--fg-muted))",
    fontStyle: "normal",
    marginLeft: "10px",
  },
});

const argusHighlight = HighlightStyle.define([
  { tag: tags.tagName, color: "hsl(var(--primary))", fontWeight: "600" },
  { tag: tags.angleBracket, color: "hsl(var(--fg-muted))" },
  { tag: tags.attributeName, color: "hsl(var(--info))" },
  { tag: tags.attributeValue, color: "hsl(var(--success))" },
  { tag: tags.string, color: "hsl(var(--success))" },
  { tag: tags.comment, color: "hsl(var(--fg-muted) / 0.7)", fontStyle: "italic" },
  { tag: tags.keyword, color: "hsl(var(--warning))" },
]);

export const TemplateCodeEditor = forwardRef<TemplateCodeEditorHandle, TemplateCodeEditorProps>(
  function TemplateCodeEditor({ value, onChange, variables, testId, onFocus, onBlur }, ref) {
    const hostRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    const completionCompartment = useRef(new Compartment());
    const variablesRef = useRef(variables);
    const onChangeRef = useRef(onChange);
    const onFocusRef = useRef(onFocus);
    const onBlurRef = useRef(onBlur);
    const syncingExternalRef = useRef(false);

    variablesRef.current = variables;
    onChangeRef.current = onChange;
    onFocusRef.current = onFocus;
    onBlurRef.current = onBlur;

    useImperativeHandle(ref, () => ({
      insertText(text: string) {
        const view = viewRef.current;
        if (!view) return;
        const { from, to } = view.state.selection.main;
        view.dispatch({
          changes: { from, to, insert: text },
          selection: { anchor: from + text.length },
        });
        view.focus();
      },
      focus() {
        viewRef.current?.focus();
      },
    }));

    useEffect(() => {
      if (!hostRef.current) return;

      const variableCompletionSource = (context: CompletionContext) => {
        const match = context.matchBefore(/\{\{[\w.]*/);
        if (!match) return null;
        if (match.from === match.to && !context.explicit) return null;

        const options: Completion[] = variablesRef.current.map((v) => ({
          label: `{{${v.name}}}`,
          type: "variable",
          detail: v.sample ? `= ${v.sample}` : v.group,
          info: v.description,
          boost: v.group === "report" ? 3 : v.group === "fragment" ? 2 : 1,
          apply: `{{${v.name}}}`,
        }));

        return {
          from: match.from,
          options,
          validFor: /^\{\{[\w.]*$/,
        };
      };

      const state = EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          history(),
          foldGutter(),
          drawSelection(),
          indentOnInput(),
          bracketMatching(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          htmlLang(),
          syntaxHighlighting(argusHighlight),
          argusTheme,
          EditorView.lineWrapping,
          completionCompartment.current.of(
            autocompletion({
              override: [variableCompletionSource],
            }),
          ),
          keymap.of([
            ...completionKeymap,
            ...defaultKeymap,
            ...searchKeymap,
            ...historyKeymap,
            ...foldKeymap,
            indentWithTab,
          ]),
          EditorView.updateListener.of((update) => {
            if (update.focusChanged) {
              if (update.view.hasFocus) onFocusRef.current?.();
              else onBlurRef.current?.();
            }
            if (update.docChanged && !syncingExternalRef.current) {
              onChangeRef.current(update.state.doc.toString());
            }
          }),
        ],
      });

      const view = new EditorView({
        state,
        parent: hostRef.current,
      });
      viewRef.current = view;

      return () => {
        view.destroy();
        viewRef.current = null;
      };
      // Mount once; external updates are synchronized cleanly via separate effect below.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
      const view = viewRef.current;
      if (!view) return;
      const current = view.state.doc.toString();
      if (current === value) return;
      syncingExternalRef.current = true;
      try {
        view.dispatch({
          changes: { from: 0, to: current.length, insert: value },
        });
      } finally {
        syncingExternalRef.current = false;
      }
    }, [value]);

    return (
      <div
        ref={hostRef}
        data-testid={testId}
        className="overflow-hidden rounded-lg border border-border/70 bg-surface focus-within:border-primary"
      />
    );
  },
);
