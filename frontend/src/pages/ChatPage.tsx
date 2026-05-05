import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import api from "@/api/client";
import { usePatient } from "@/contexts/PatientContext";
import { FileText, MessageCircle, Plus, Send } from "lucide-react";

interface ChatSource {
  id: number;
  filename: string | null;
  doc_type: string | null;
  event_date: string | null;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  created_at?: string;
  sources?: ChatSource[];
}

export default function ChatPage() {
  const { selectedPatient } = usePatient();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!selectedPatient) return;
    api
      .get("/chat/history", { params: { patient_id: selectedPatient.id } })
      .then((res) => setMessages(res.data.messages || []));
  }, [selectedPatient]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Collect every unique source mentioned anywhere in the conversation,
  // most-recent first so the sidebar reflects the latest answer's context.
  const allSources = useMemo<ChatSource[]>(() => {
    const seen = new Set<number>();
    const list: ChatSource[] = [];
    for (let i = messages.length - 1; i >= 0; i--) {
      const srcs = messages[i].sources;
      if (!srcs) continue;
      for (const s of srcs) {
        if (seen.has(s.id)) continue;
        seen.add(s.id);
        list.push(s);
      }
    }
    return list;
  }, [messages]);

  const send = async () => {
    if (!input.trim() || loading) return;
    const msg = input.trim();
    setInput("");
    setMessages((m) => [...m, { role: "user", content: msg }]);
    setLoading(true);

    try {
      const res = await api.post("/chat", {
        patient_id: selectedPatient?.id,
        message: msg,
      });
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: res.data.response,
          sources: Array.isArray(res.data.sources) ? res.data.sources : [],
        },
      ]);
    } catch {
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: "Sorry, I encountered an error. Please try again.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  if (!selectedPatient) {
    return (
      <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
        <MessageCircle className="h-8 w-8" />
        <p>Select a patient to start a conversation</p>
      </div>
    );
  }

  const startNewChat = async () => {
    if (loading) return;
    try {
      await api.delete("/chat/history", {
        params: { patient_id: selectedPatient?.id },
      });
      setMessages([]);
    } catch {
      // ignore — leave UI as is
    }
  };

  return (
    <div className="flex h-[calc(100vh-10rem)] gap-4">
      {/* Conversation column */}
      <div className="flex flex-1 flex-col min-w-0">
        <div className="mb-4 flex items-center justify-end">
          <button
            onClick={startNewChat}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            Start new chat
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto rounded-lg border p-4">
          {messages.length === 0 && (
            <p className="py-8 text-center text-muted-foreground">
              Ask a question about {selectedPatient.display_name}'s medical
              history
            </p>
          )}
          {messages.map((msg, i) => {
            // Resolve an LLM-emitted href back to /documents/<id> when the
            // model produced a filename-only link. Keeps already-correct
            // /documents/<id> links untouched.
            const resolveHref = (href: string | undefined): string => {
              if (!href) return "#";
              if (/^\/documents\/\d+$/.test(href)) return href;
              const sources = msg.sources || [];
              const stripped = href
                .replace(/^\/+/, "")
                .replace(/^documents\//, "");
              const match = sources.find(
                (s) =>
                  s.filename &&
                  (s.filename === href || s.filename === stripped),
              );
              if (match) return `/documents/${match.id}`;
              return href;
            };
            return (
              <div
                key={i}
                className={`mb-4 ${msg.role === "user" ? "text-right" : ""}`}
              >
                <div
                  className={`inline-block max-w-[80%] rounded-lg px-4 py-2 text-sm ${
                    msg.role === "user"
                      ? "bg-primary text-primary-foreground whitespace-pre-wrap text-left"
                      : "bg-muted text-left"
                  }`}
                >
                  {msg.role === "assistant" ? (
                    <div className="markdown-body">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          p: ({ children }) => (
                            <p className="my-1.5 leading-relaxed">{children}</p>
                          ),
                          ul: ({ children }) => (
                            <ul className="my-1.5 list-disc pl-5 space-y-0.5">
                              {children}
                            </ul>
                          ),
                          ol: ({ children }) => (
                            <ol className="my-1.5 list-decimal pl-5 space-y-0.5">
                              {children}
                            </ol>
                          ),
                          li: ({ children }) => (
                            <li className="leading-relaxed">{children}</li>
                          ),
                          h1: ({ children }) => (
                            <h1 className="my-2 text-base font-semibold">
                              {children}
                            </h1>
                          ),
                          h2: ({ children }) => (
                            <h2 className="my-2 text-sm font-semibold">
                              {children}
                            </h2>
                          ),
                          h3: ({ children }) => (
                            <h3 className="my-2 text-sm font-semibold">
                              {children}
                            </h3>
                          ),
                          strong: ({ children }) => (
                            <strong className="font-semibold">
                              {children}
                            </strong>
                          ),
                          em: ({ children }) => (
                            <em className="italic">{children}</em>
                          ),
                          code: ({ children, className }) =>
                            className ? (
                              <code
                                className={`${className} block rounded bg-background/60 px-2 py-1 text-xs`}
                              >
                                {children}
                              </code>
                            ) : (
                              <code className="rounded bg-background/60 px-1 py-0.5 text-xs">
                                {children}
                              </code>
                            ),
                          pre: ({ children }) => (
                            <pre className="my-2 overflow-x-auto rounded bg-background/60 p-2 text-xs">
                              {children}
                            </pre>
                          ),
                          a: ({ href, children }) => {
                            const resolved = resolveHref(href);
                            // Internal doc links route through the SPA so
                            // clicking them lands on the document detail page
                            // instead of full-page navigating away.
                            if (/^\/documents\/\d+$/.test(resolved)) {
                              return (
                                <Link
                                  to={resolved}
                                  className="text-primary underline"
                                >
                                  {children}
                                </Link>
                              );
                            }
                            return (
                              <a
                                href={resolved}
                                target="_blank"
                                rel="noreferrer"
                                className="text-primary underline"
                              >
                                {children}
                              </a>
                            );
                          },
                          table: ({ children }) => (
                            <div className="my-2 overflow-x-auto">
                              <table className="border-collapse text-xs">
                                {children}
                              </table>
                            </div>
                          ),
                          th: ({ children }) => (
                            <th className="border px-2 py-1 text-left font-semibold">
                              {children}
                            </th>
                          ),
                          td: ({ children }) => (
                            <td className="border px-2 py-1">{children}</td>
                          ),
                          blockquote: ({ children }) => (
                            <blockquote className="my-2 border-l-2 border-muted-foreground/40 pl-3 italic">
                              {children}
                            </blockquote>
                          ),
                          hr: () => (
                            <hr className="my-2 border-muted-foreground/20" />
                          ),
                        }}
                      >
                        {msg.content}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    msg.content
                  )}
                </div>
                {msg.role === "assistant" &&
                  msg.sources &&
                  msg.sources.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground mt-1">
                        Sources
                      </span>
                      {msg.sources.map((src) => (
                        <Link
                          key={src.id}
                          to={`/documents/${src.id}`}
                          className="inline-flex items-center gap-1 rounded-full border bg-background px-2 py-0.5 text-xs hover:bg-accent"
                          title={
                            [src.doc_type, src.event_date]
                              .filter(Boolean)
                              .join(" • ") || "Open document"
                          }
                        >
                          <FileText className="h-3 w-3 text-primary" />
                          <span className="truncate max-w-[240px]">
                            {src.filename || `Document #${src.id}`}
                          </span>
                        </Link>
                      ))}
                    </div>
                  )}
              </div>
            );
          })}
          {loading && (
            <div className="mb-4">
              <div className="inline-block rounded-lg bg-muted px-4 py-2 text-sm text-muted-foreground">
                Thinking...
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="mt-3 flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder="Ask about medical history..."
            className="flex-1 rounded-md border px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            disabled={loading}
          />
          <button
            onClick={send}
            disabled={loading || !input.trim()}
            className="rounded-md bg-primary px-4 py-2 text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Sources sidebar */}
      <aside className="hidden lg:flex w-72 flex-col rounded-lg border bg-card">
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <FileText className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">Source documents</span>
          {allSources.length > 0 && (
            <span className="ml-auto text-xs text-muted-foreground">
              {allSources.length}
            </span>
          )}
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {allSources.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">
              Documents the assistant cites will show up here.
            </p>
          ) : (
            <ul className="space-y-1">
              {allSources.map((src) => (
                <li key={src.id}>
                  <Link
                    to={`/documents/${src.id}`}
                    className="flex flex-col gap-0.5 rounded-md border bg-background px-2 py-1.5 text-xs hover:bg-accent"
                    title={src.filename || `Document #${src.id}`}
                  >
                    <span className="flex items-center gap-1.5 font-medium">
                      <FileText className="h-3 w-3 flex-shrink-0 text-primary" />
                      <span className="truncate">
                        {src.filename || `Document #${src.id}`}
                      </span>
                    </span>
                    {(src.doc_type || src.event_date) && (
                      <span className="pl-4 text-[10px] text-muted-foreground">
                        {[src.doc_type, src.event_date]
                          .filter(Boolean)
                          .join(" • ")}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}
