export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { images } = req.body;

  if (!images || !Array.isArray(images) || images.length === 0) {
    return res.status(400).json({ error: 'No images provided' });
  }

  const GEMINI_API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY || process.env.GEMINI_API_KEY;

  if (!GEMINI_API_KEY) {
    return res.status(500).json({ error: 'GEMINI_API_KEY no configurada en las variables de entorno.' });
  }

  const prompt = `Eres un asistente experto en analizar tickets de supermercado argentinos.
Analiza las siguientes imágenes de un ticket de compra y extrae TODOS los productos.

REGLAS IMPORTANTES:
1. Si un producto aparece con multiplicador (ej: "x2", "X3", "2x", "3 UN"), pon quantity=2 (o el número indicado) y unit_price = precio unitario
2. Si el mismo producto aparece repetido en dos líneas separadas, agrúpalos en uno solo sumando cantidades
3. Extrae el supermercado del encabezado del ticket (ej: "Coto", "Jumbo", "Carrefour", "Día", etc.)
4. Extrae la fecha de compra del ticket (formato YYYY-MM-DD)
5. Extrae el total del ticket
6. Para cada producto: nombre completo (si está abreviado, intenta inferir el nombre completo), marca si es visible, cantidad, unidad (kg/litro/unidad), precio unitario, precio total

Responde ÚNICAMENTE con un JSON válido, sin texto adicional, con esta estructura exacta:
{
  "supermarket": "nombre del supermercado o null si no se puede leer",
  "purchase_date": "YYYY-MM-DD o null si no se puede leer",
  "total_amount": número o null,
  "items": [
    {
      "product_name": "nombre del producto",
      "brand": "marca o null",
      "quantity": número,
      "unit": "kg/litro/unidad/null",
      "unit_price": número,
      "total_price": número
    }
  ]
}`;

  const parts = [{ text: prompt }];

  for (const imageBase64 of images) {
    const matches = imageBase64.match(/^data:(.+);base64,(.+)$/);
    if (matches) {
      parts.push({
        inline_data: {
          mime_type: matches[1],
          data: matches[2],
        },
      });
    }
  }

  // Modelos en orden de preferencia
  const MODELS = [
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-2.0-flash-lite',
    'gemini-flash-latest',
  ];

  for (const model of MODELS) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts }],
            generationConfig: {
              temperature: 0.1,
            },
          }),
        }
      );

      if (response.status === 429) {
        console.warn(`Model ${model} quota exceeded, trying next...`);
        continue;
      }

      if (!response.ok) {
        const errText = await response.text();
        console.error(`Gemini error (${model}):`, errText);
        continue;
      }

      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!text) {
        console.warn(`Empty response from ${model}, trying next...`);
        continue;
      }

      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[0]);
        } else {
          console.warn(`Could not parse JSON from ${model}, trying next...`);
          continue;
        }
      }

      console.log(`Success with model: ${model}`);
      return res.status(200).json(parsed);

    } catch (err) {
      console.error(`Error with model ${model}:`, err.message);
      continue;
    }
  }

  return res.status(429).json({
    error: 'Cuota de la API de IA agotada por hoy. Intentá más tarde o usá la carga manual.',
    hint: 'El límite gratuito de Gemini es de 1,500 requests por día.'
  });
}
