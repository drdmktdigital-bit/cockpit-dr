exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return {
      statusCode: 200,
      body: JSON.stringify({
        text: "⚠ Chat indisponível: configure a variável ANTHROPIC_API_KEY nas Environment Variables do Netlify.",
      }),
    };
  }
  try {
    const { messages } = JSON.parse(event.body || "{}");
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 4000, messages }),
    });
    const data = await r.json();
    const text = (data.content || [])
      .filter((i) => i.type === "text")
      .map((i) => i.text)
      .join("\n");
    return { statusCode: 200, body: JSON.stringify({ text: text || "Sem resposta." }) };
  } catch (e) {
    return {
      statusCode: 200,
      body: JSON.stringify({ text: "⚠ Erro ao falar com o Claude. Tente novamente." }),
    };
  }
};
