import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import api from "@/api/client";
import { usePatient } from "@/contexts/PatientContext";
import { FileText, MessageCircle, Plus, Send } from "lucide-react";

interface ChatSource {
  id: number;
  filename: string | null;
  doc_type: string | null;
  doc_date: string | null;
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
        { role: "assistant", content: "Sorry, I encountered an error. Please try again." },
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
    <div className="flex h-[calc(100vh-10rem)] flex-col">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">
          Chat — {selectedPatient.display_name}
        </h1>
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
            Ask a question about {selectedPatient.display_name}'s medical history
          </p>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`mb-4 ${msg.role === "user" ? "text-right" : ""}`}
          >
            <div
              className={`inline-block max-w-[80%] rounded-lg px-4 py-2 text-sm ${
                msg.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted"
              }`}
            >
              <p className="whitespace-pre-wrap">{msg.content}</p>
            </div>
            {msg.role === "assistant" && msg.sources && msg.sources.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground mt-1">Sources</span>
                {msg.sources.map((src) => (
                  <Link
                    key={src.id}
                    to={`/documents/${src.id}`}
                    className="inline-flex items-center gap-1 rounded-full border bg-background px-2 py-0.5 text-xs hover:bg-accent"
                    title={[src.doc_type, src.doc_date].filter(Boolean).join(" • ") || "Open document"}
                  >
                    <FileText className="h-3 w-3 text-primary" />
                    <span className="truncate max-w-[240px]">{src.filename || `Document #${src.id}`}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        ))}
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
  );
}
