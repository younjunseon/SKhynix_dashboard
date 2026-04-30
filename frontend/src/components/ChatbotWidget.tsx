import { useEffect, useRef, useState } from "react";

interface Message {
  role: "user" | "bot";
  text: string;
  ts: number;
}

const SUGGESTIONS = [
  "오늘 가장 위험한 wafer는?",
  "예측 불량률 추이 알려줘",
  "지난 주 대비 변화는?",
  "Top 10 위험 unit 보여줘",
];

function botReply(input: string): string {
  // 임시 mock 응답 — 추후 LLM API로 교체
  const text = input.toLowerCase();
  if (text.includes("위험") && text.includes("wafer")) {
    return "현재 split=test 기준 위험률 상위 wafer는 좌측 사이드바 → Wafer Map 탭의 목록 최상단을 확인하세요. 위험 wafer 카드 클릭 시 die 단위 히트맵으로 drill-down 됩니다.";
  }
  if (text.includes("불량률") || text.includes("추이")) {
    return "Overview 페이지의 듀얼축 차트에서 일/주/월 단위 완료수량과 불량률을 함께 볼 수 있습니다. train(실측) 막대와 val·test(예측) 막대가 색으로 구분됩니다.";
  }
  if (text.includes("unit")) {
    return "Data 페이지에서 split·검색·정렬을 적용해 unit 단위 데이터를 확인할 수 있고, '위험 unit만' 토글로 필터링도 가능합니다. 행의 wafer를 클릭하면 해당 wafer 진단 페이지로 이동합니다.";
  }
  return "아직 학습 중인 질문이에요. AI Agent는 추후 LLM과 연동되어 데이터 질의·요약·근거 피처(SHAP) 분석까지 답변할 예정입니다.";
}

export default function ChatbotWidget() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "bot",
      text: "안녕하세요! Wafer Health AI Agent입니다. 위험 wafer/unit, 불량률 추이, 데이터 검색 등을 물어보세요.",
      ts: Date.now(),
    },
  ]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, open]);

  function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    const userMsg: Message = { role: "user", text: trimmed, ts: Date.now() };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setTimeout(() => {
      setMessages((prev) => [
        ...prev,
        { role: "bot", text: botReply(trimmed), ts: Date.now() },
      ]);
    }, 400);
  }

  return (
    <>
      {/* 플로팅 버튼 */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-6 right-6 w-14 h-14 rounded-full text-white flex items-center justify-center transition-all hover:scale-105 z-40"
        style={{
          background: "linear-gradient(135deg, #4c1d95 0%, #7c3aed 100%)",
          boxShadow: "0 8px 24px rgba(76, 29, 149, 0.35)",
        }}
        aria-label="챗봇 열기"
      >
        {open ? (
          <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.86 9.86 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
        )}
      </button>

      {/* 챗봇 패널 */}
      {open && (
        <div
          className="fixed bottom-24 right-6 w-[380px] h-[540px] bg-white rounded-2xl shadow-cardHover border border-brand-border z-40 flex flex-col overflow-hidden"
          style={{ boxShadow: "0 12px 40px rgba(15, 23, 42, 0.18)" }}
        >
          {/* 헤더 */}
          <div
            className="px-4 py-3 text-white flex items-center gap-3"
            style={{ background: "linear-gradient(135deg, #4c1d95 0%, #2e1065 100%)" }}
          >
            <div className="w-9 h-9 rounded-full bg-white/15 ring-2 ring-white/20 flex items-center justify-center">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-[14px]">Wafer AI Agent</div>
              <div className="text-[11px] text-white/70 flex items-center gap-1">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-brand-success"></span>
                온라인
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="w-7 h-7 rounded-full hover:bg-white/15 flex items-center justify-center"
              aria-label="닫기"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* 메시지 영역 */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3 bg-brand-subtle">
            {messages.map((m, i) => (
              <div
                key={i}
                className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[80%] px-3 py-2 rounded-2xl text-[12.5px] leading-relaxed ${
                    m.role === "user"
                      ? "bg-brand-primary text-white rounded-br-sm"
                      : "bg-white text-brand-text shadow-card rounded-bl-sm"
                  }`}
                >
                  {m.text}
                </div>
              </div>
            ))}
          </div>

          {/* 빠른 질문 */}
          {messages.length <= 1 && (
            <div className="px-3 py-2 border-t border-brand-border bg-white">
              <div className="text-[10px] text-brand-textMuted mb-1.5 px-1">추천 질문</div>
              <div className="flex flex-wrap gap-1.5">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="text-[11px] px-2.5 py-1 rounded-full border border-brand-border text-brand-textMuted hover:border-brand-primary hover:text-brand-primary transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 입력 */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            className="px-3 py-2.5 border-t border-brand-border bg-white flex items-center gap-2"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="메시지를 입력하세요…"
              className="flex-1 text-[12.5px] px-3 py-2 rounded-full border border-brand-border focus:outline-none focus:border-brand-primary bg-brand-subtle"
            />
            <button
              type="submit"
              disabled={!input.trim()}
              className="w-9 h-9 rounded-full bg-brand-primary text-white flex items-center justify-center disabled:opacity-40 hover:bg-brand-primaryDark transition-colors"
              aria-label="전송"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
              </svg>
            </button>
          </form>
        </div>
      )}
    </>
  );
}
