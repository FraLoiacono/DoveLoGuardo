const ISO1_TO_3={en:"eng",it:"ita",fr:"fra",es:"spa",de:"deu",ja:"jpn",ko:"kor",zh:"zho",pt:"por",ru:"rus",ar:"ara",hi:"hin",sv:"swe",da:"dan",no:"nor",nl:"nld",pl:"pol",tr:"tur",el:"ell"};

async function originalLanguagesFromWikidata(imdbId){
  if(!imdbId)return[];
  const query=`SELECT DISTINCT ?iso1 ?iso3 WHERE {
    ?item wdt:P345 "${imdbId}"; wdt:P364 ?lang.
    OPTIONAL { ?lang wdt:P218 ?iso1. }
    OPTIONAL { ?lang wdt:P219 ?iso3. }
  }`;
  try{
    const url="https://query.wikidata.org/sparql?"+new URLSearchParams({query,format:"json"});
    const r=await fetch(url,{headers:{Accept:"application/sparql-results+json","User-Agent":"DoveLoGuardo/1.0"}});
    if(!r.ok)return[];
    const data=await r.json(),out=[];
    for(const b of data?.results?.bindings||[]){
      const iso3=b?.iso3?.value?.toLowerCase(),iso1=b?.iso1?.value?.toLowerCase();
      const code=iso3||ISO1_TO_3[iso1];
      if(code&&!out.includes(code))out.push(code);
    }
    return out;
  }catch{return[]}
}

export default async function handler(req,res){
  if(req.method!=="GET"){res.setHeader("Allow","GET");return res.status(405).json({error:"Metodo non consentito"});}
  const title=String(req.query.title||"").trim();
  if(!title)return res.status(400).json({error:"Inserisci un titolo."});
  const apiKey=process.env.STREAMING_API_KEY;
  if(!apiKey)return res.status(500).json({error:"La variabile STREAMING_API_KEY non è configurata su Vercel."});
  try{
    const params=new URLSearchParams({title,country:"it",show_type:"movie",output_language:"it"});
    const response=await fetch(`https://api.movieofthenight.com/v4/shows/search/title?${params}`,{headers:{"X-API-Key":apiKey,Accept:"application/json"}});
    if(!response.ok){
      if(response.status===401||response.status===403)return res.status(502).json({error:"API key non valida o non autorizzata."});
      if(response.status===429)return res.status(429).json({error:"Limite API raggiunto. Riprova più tardi."});
      return res.status(502).json({error:"Errore dal servizio di disponibilità streaming."});
    }
    const shows=await response.json();
    const list=Array.isArray(shows)?shows.slice(0,10):[];
    const results=await Promise.all(list.map(async show=>{
      const originalLanguages=await originalLanguagesFromWikidata(show.imdbId);
      const options=show?.streamingOptions?.it||[];
      const normalized=options.map(opt=>{
        const audios=(opt.audios||[]).map(a=>String(a.language||"").toLowerCase()).filter(Boolean);
        const subtitles=(opt.subtitles||[]).map(s=>String(s?.locale?.language||"").toLowerCase()).filter(Boolean);
        return{
          service:opt?.service?.name||opt?.service?.id||"Servizio",type:opt.type||null,link:opt.link||null,
          quality:opt.quality||null,price:opt?.price?.formatted||null,audios,subtitles,
          originalAudio:originalLanguages.length>0&&originalLanguages.some(l=>audios.includes(l)),
          italianSubs:subtitles.includes("ita")
        };
      });
      return{title:show.title||"",originalTitle:show.originalTitle||"",year:show.releaseYear||null,overview:show.overview||"",
        poster:show?.imageSet?.verticalPoster?.w360||null,imdbId:show.imdbId||null,originalLanguages,options:normalized};
    }));
    res.setHeader("Cache-Control","s-maxage=900, stale-while-revalidate=1800");
    return res.status(200).json({results});
  }catch{
    return res.status(500).json({error:"Impossibile completare la ricerca in questo momento."});
  }
}
