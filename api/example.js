// Vercel Serverless Function：后端中转，调用Anthropic API
// API Key通过Vercel环境变量ANTHROPIC_API_KEY读取，不会暴露给浏览器

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { word, meaning } = req.body || {};
  if (!word || !meaning) {
    res.status(400).json({ error: "缺少word或meaning参数" });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "服务端未配置API Key" });
    return;
  }

  const prompt = `请为韩语TOPIK单词"${word}"（中文含义：${meaning}）生成一个TOPIK II水平（中高级）的例句，要求：
1. 句子自然、符合该词常见用法
2. 用 **粗体标记（**词语**）** 标出该单词在句中的实际形态
3. 给出对应的中文翻译

请严格按以下JSON格式输出，不要有任何多余文字、不要使用markdown代码块包裹：
{"sentence": "韩语例句（含**粗体标记**）", "translation": "中文翻译"}`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 500,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      res.status(response.status).json({ error: `Anthropic API错误: ${errText}` });
      return;
    }

    const data = await response.json();
    const block = data.content?.find((c) => c.type === "text");
    const text = block ? block.text : "";

    // 解析返回的JSON（去除可能的markdown代码块包裹）
    const cleaned = text.replace(/```json|```/g, "").trim();
    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      // 解析失败时，把原始文本作为例句返回，避免前端报错
      parsed = { sentence: cleaned, translation: "" };
    }

    res.status(200).json(parsed);
  } catch (err) {
    res.status(500).json({ error: `请求失败: ${err.message}` });
  }
}
