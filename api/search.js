const ISO1_TO_3 = {
  en: "eng",
  it: "ita",
  fr: "fra",
  es: "spa",
  de: "deu",
  ja: "jpn",
  ko: "kor",
  zh: "zho",
  pt: "por",
  ru: "rus",
  ar: "ara",
  hi: "hin",
  sv: "swe",
  da: "dan",
  no: "nor",
  nl: "nld",
  pl: "pol",
  tr: "tur",
  el: "ell"
};


// ======================================================
// RECUPERA LE LINGUE ORIGINALI DI TUTTI I FILM INSIEME
// ======================================================

async function originalLanguagesBatch(imdbIds) {
  const ids = [...new Set((imdbIds || []).filter(Boolean))];

  if (!ids.length) {
    return {};
  }

  const values = ids
    .map(id => `"${id.replace(/"/g, "")}"`)
    .join(" ");

  const query = `
    SELECT DISTINCT ?imdb ?iso1 ?iso3 WHERE {

      VALUES ?imdb { ${values} }

      ?item wdt:P345 ?imdb;
            wdt:P364 ?lang.

      OPTIONAL {
        ?lang wdt:P218 ?iso1.
      }

      OPTIONAL {
        ?lang wdt:P219 ?iso3.
      }
    }
  `;

  try {

    const url =
      "https://query.wikidata.org/sparql?" +
      new URLSearchParams({
        query,
        format: "json"
      });

    const response = await fetch(url, {
      headers: {
        Accept: "application/sparql-results+json",
        "User-Agent": "DoveLoGuardo/1.1"
      }
    });

    if (!response.ok) {
      return {};
    }

    const data = await response.json();

    const result = {};

    for (const item of data?.results?.bindings || []) {

      const imdb = item?.imdb?.value;

      const iso3 =
        item?.iso3?.value?.toLowerCase();

      const iso1 =
        item?.iso1?.value?.toLowerCase();

      const language =
        iso3 || ISO1_TO_3[iso1];

      if (!imdb || !language) {
        continue;
      }

      if (!result[imdb]) {
        result[imdb] = [];
      }

      if (!result[imdb].includes(language)) {
        result[imdb].push(language);
      }
    }

    return result;

  } catch (error) {

    console.error(
      "Errore Wikidata:",
      error
    );

    return {};
  }
}


// ======================================================
// API PRINCIPALE
// ======================================================

export default async function handler(req, res) {

  // Accettiamo solamente richieste GET

  if (req.method !== "GET") {

    res.setHeader(
      "Allow",
      "GET"
    );

    return res.status(405).json({
      error: "Metodo non consentito"
    });
  }


  // ====================================================
  // TITOLO DEL FILM
  // ====================================================

  const title =
    String(req.query.title || "").trim();

  if (!title) {

    return res.status(400).json({
      error: "Inserisci un titolo."
    });
  }


  // ====================================================
  // API KEY
  // ====================================================

  const apiKey =
    process.env.STREAMING_API_KEY;

  if (!apiKey) {

    return res.status(500).json({
      error:
        "La variabile STREAMING_API_KEY non è configurata su Vercel."
    });
  }


  try {

    // ==================================================
    // PARAMETRI DI RICERCA
    // ==================================================

    const params =
      new URLSearchParams({

        title: title,

        // Cerchiamo disponibilità in Italia
        country: "it",

        // Solo film
        show_type: "movie",

        // La API non supporta italiano
        // come output_language
        output_language: "en"
      });


    // ==================================================
    // STREAMING AVAILABILITY API
    // ==================================================

    const response = await fetch(

      `https://api.movieofthenight.com/v4/shows/search/title?${params}`,

      {
        headers: {

          "X-API-Key":
            apiKey,

          Accept:
            "application/json"
        }
      }
    );


    // ==================================================
    // GESTIONE ERRORI API
    // ==================================================

    if (!response.ok) {

      if (
        response.status === 401 ||
        response.status === 403
      ) {

        return res.status(502).json({
          error:
            "API key non valida o non autorizzata."
        });
      }


      if (response.status === 429) {

        return res.status(429).json({
          error:
            "Limite API raggiunto. Riprova più tardi."
        });
      }


      return res.status(502).json({
        error:
          "Errore dal servizio di disponibilità streaming."
      });
    }


    // ==================================================
    // RISULTATI
    // ==================================================

    const shows =
      await response.json();


    /*
      Limitiamo a 6 film.

      Questo rende la ricerca molto più veloce
      rispetto alla versione precedente.
    */

    const list =
      Array.isArray(shows)
        ? shows.slice(0, 6)
        : [];


    // ==================================================
    // LINGUA ORIGINALE
    // ==================================================

    /*
      IMPORTANTE:

      Prima facevamo una richiesta Wikidata
      separata PER OGNI FILM.

      Adesso mandiamo tutti gli IMDb ID
      in UNA SOLA richiesta.
    */

    const languageMap =
      await originalLanguagesBatch(

        list.map(
          show => show.imdbId
        )
      );


    // ==================================================
    // PREPARAZIONE RISULTATI
    // ==================================================

    const results =
      list.map(show => {


        // Lingua originale

        const originalLanguages =
          languageMap[show.imdbId] || [];


        // Opzioni streaming italiane

        const options =
          show?.streamingOptions?.it || [];


        const normalized =
          options.map(opt => {


            // ==========================================
            // AUDIO DISPONIBILI
            // ==========================================

            const audios =
              (opt.audios || [])

                .map(audio =>
                  String(
                    audio.language || ""
                  ).toLowerCase()
                )

                .filter(Boolean);


            // ==========================================
            // SOTTOTITOLI DISPONIBILI
            // ==========================================

            const subtitles =
              (opt.subtitles || [])

                .map(subtitle =>
                  String(
                    subtitle
                      ?.locale
                      ?.language || ""
                  ).toLowerCase()
                )

                .filter(Boolean);


            // ==========================================
            // CONTROLLO AUDIO ORIGINALE
            // ==========================================

            const originalAudio =

              originalLanguages.length > 0 &&

              originalLanguages.some(
                language =>
                  audios.includes(language)
              );


            // ==========================================
            // CONTROLLO SUB ITALIANI
            // ==========================================

            const italianSubs =
              subtitles.includes("ita");


            // ==========================================
            // RISULTATO DEL SERVIZIO
            // ==========================================

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
                opt?.price?.formatted ||
                null,

              audios:
                audios,

              subtitles:
                subtitles,

              originalAudio:
                originalAudio,

              italianSubs:
                italianSubs
            };
          });


        // ==============================================
        // RISULTATO FILM
        // ==============================================

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

          originalLanguages:
            originalLanguages,

          options:
            normalized
        };
      });


    // ==================================================
    // CACHE
    // ==================================================

    /*
      Se qualcuno cerca nuovamente lo stesso film,
      Vercel può servire il risultato dalla cache.

      s-maxage=1800
      = cache per 30 minuti

      stale-while-revalidate=86400
      = può mostrare il risultato precedente mentre
        aggiorna i dati in background.
    */

    res.setHeader(

      "Cache-Control",

      "s-maxage=1800, stale-while-revalidate=86400"
    );


    // ==================================================
    // RISPOSTA
    // ==================================================

    return res.status(200).json({
      results: results
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
