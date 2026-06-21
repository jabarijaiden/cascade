import "./globals.css";

export const metadata = {
  title: "Cascade | Multi-Agent Adversarial Idea Validator",
  description: "An AI-powered startup feasibility analysis engine running a 5-agent debate model using Gemini 2.0 Flash and Supabase.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
