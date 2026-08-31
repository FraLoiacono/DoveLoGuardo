export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");

    return res.status(405).json({
      error: "Metodo non consentito"
    });
  }

  const title = String(req.query.title || "").trim();

  if (!title) {
    return res.status(400).json({
      error: "Inserisci un titolo."
    });
  }

  const apiKey = process.env.STREAMING_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      error:
        "La variabile STREAMING_API_KEY non è configurata su Vercel."
    });
  }

  try {
    const params = new URLSearchParams({
      title,
      country: "it",
      show_type: "movie",
      output_language: "en"
    });

    const response = await fetch(
      `https://api.movieofthenight.com/v4/shows/search/title?${params}`,
      {
        headers: {
          "X-API-Key": apiKey,
          Accept: "application/json"
        }
      }
    );

    if (!response.ok) {
      if (
        response.status === 401 ||
        response.status === 403
      ) {
        return res.status(502).json({
          error: "API key non valida o non autorizzata."
        });
      }

      if (response.status === 429) {
        return res.status(429).json({
          error: "Limite API raggiunto. Riprova più tardi."
        });
      }

      return res.status(502).json({
        error:
          "Errore dal servizio di disponibilità streaming."
      });
    }

    const shows = await response.json();

    const list =
      Array.isArray(shows)
        ? shows.slice(0, 5)
        : [];

    const results = list.map(show => {
      const options =
        show?.streamingOptions?.it || [];

      const normalized = options.map(opt => {
        const audios = (opt.audios || [])
          .map(audio =>
            String(
              audio.language || ""
            ).toLowerCase()
          )
          .filter(Boolean);

        const subtitles = (opt.subtitles || [])
          .map(subtitle =>
            String(
              subtitle
                ?.locale
                ?.language || ""
            ).toLowerCase()
          )
          .filter(Boolean);

        return {
          service:
            opt?.service?.name ||
            opt?.service?.id ||
            "Servizio",

          type:
            opt.type || null,

          link:
            opt.link || null,

          quality:
            opt.quality || null,

          price:
            opt?.price?.formatted || null,

          audios,

          subtitles,

          italianSubs:
            subtitles.includes("ita")
        };
      });

      return {
        title:
          show.title || "",

        originalTitle:
          show.originalTitle || "",

        year:
          show.releaseYear || null,

        overview:
          show.overview || "",

        poster:
          show
            ?.imageSet
            ?.verticalPoster
            ?.w360 || null,

        imdbId:
          show.imdbId || null,

        options:
          normalized
      };
    });

    res.setHeader(
      "Cache-Control",
      "s-maxage=3600, stale-while-revalidate=86400"
    );

    return res.status(200).json({
      results
    });

  } catch (error) {
    console.error(
      "Errore ricerca:",
      error
    );

    return res.status(500).json({
      error:
        "Impossibile completare la ricerca in questo momento."
    });
  }
}
