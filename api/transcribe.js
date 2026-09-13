// Vercel Serverless Function: POST /api/transcribe
// Body: raw audio bytes (Content-Type: audio/wav), from the combined recording.
// Returns: { raw: "<STT 그대로>", cleaned: "<군더더기 정리된 버전>" }
//
// OPENAI_API_KEY가 Vercel 프로젝트 환경변수에 설정되어 있어야 동작합니다.
// (Settings -> Environment Variables. 브라우저 코드에는 절대 키가 노출되지 않음 -
// 이 파일은 서버에서만 실행되는 서버리스 함수입니다.)

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST만 지원합니다.' });
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'OPENAI_API_KEY가 설정되지 않았습니다. Vercel 프로젝트 Settings > Environment Variables에서 추가해주세요.' });
    return;
  }

  try {
    // 요청 바디(오디오 바이너리)를 통째로 수집
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const audioBuffer = Buffer.concat(chunks);

    if (audioBuffer.length === 0) {
      res.status(400).json({ error: '오디오 데이터가 비어있습니다.' });
      return;
    }

    // 1) STT: Whisper로 원문 전사
    const form = new FormData();
    form.append('file', new Blob([audioBuffer], { type: 'audio/wav' }), 'feedback.wav');
    form.append('model', 'whisper-1');
    form.append('language', 'ko');

    const sttResp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });

    if (!sttResp.ok) {
      const errText = await sttResp.text().catch(() => '');
      res.status(502).json({ error: '음성 전사(STT) 요청이 실패했습니다.', detail: errText });
      return;
    }

    const sttJson = await sttResp.json();
    const rawText = (sttJson.text || '').trim();

    if (!rawText) {
      res.status(200).json({ raw: '', cleaned: '' });
      return;
    }

    // 2) 정리: 의미/내용은 그대로, 군더더기(음, 어, 말더듬, 중복)만 제거
    // 이건 학생 글에 대한 새로운 판단을 추가하는 게 아니라, 선생님이 이미
    // 한 말을 그대로 다듬기만 하는 것이라 별도의 평가/윤리적 검증 부담이 없음.
    let cleanedText = rawText;
    try {
      const cleanResp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          temperature: 0.2,
          messages: [
            {
              role: 'system',
              content:
                '너는 한국어 음성 전사 편집자다. 입력된 텍스트는 교수자가 학생 과제에 대해 실시간으로 말한 피드백을 그대로 받아적은 것이다. ' +
                '"음", "어", "그니까", 같은 말 반복, 말이 끊기고 다시 시작한 부분 같은 군더더기만 제거하고 자연스러운 문장으로 다듬어라. ' +
                '절대로 새로운 내용을 추가하거나, 평가나 판단을 바꾸거나, 표현을 재해석하지 마라. 의미와 어조는 원문 그대로 유지해라. ' +
                '정리된 텍스트만 출력하고 다른 설명은 붙이지 마라.',
            },
            { role: 'user', content: rawText },
          ],
        }),
      });

      if (cleanResp.ok) {
        const cleanJson = await cleanResp.json();
        const candidate = cleanJson.choices && cleanJson.choices[0] && cleanJson.choices[0].message && cleanJson.choices[0].message.content;
        if (candidate && candidate.trim()) cleanedText = candidate.trim();
      }
      // 정리 단계가 실패해도 원문 전사(rawText)는 이미 있으니 그대로 반환 (아래 fallback)
    } catch (cleanupErr) {
      console.error('정리 단계 실패, 원문 전사로 대체:', cleanupErr);
    }

    res.status(200).json({ raw: rawText, cleaned: cleanedText });
  } catch (err) {
    console.error('transcribe 처리 중 오류:', err);
    res.status(500).json({ error: '전사 처리 중 오류가 발생했습니다.', detail: String(err) });
  }
};
