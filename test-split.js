function extractUrlsFromString(content) {
    if (!content) {
        return [];
    }
    const potentialUrls = content.split(/[\s,;\|]+/);
    const cleanedUrls = potentialUrls.map(url => {
        let cleaned = url.trim().replace(/^"|"$/g, '');
        if (!cleaned.startsWith('http') && cleaned.includes('.') && !cleaned.includes(' ')) {
            cleaned = 'https://' + cleaned;
        }
        return cleaned;
    }).filter(url =>
        url.startsWith('http') && url.length > 8
    );
    return [...new Set(cleanedUrls)];
}

const csvStr = `https://soscardio.com.br/nova-cirurgia-de-hemorroidas/
https://www.scielo.br/j/abcd/a/wFGZ54bbbdDNCBJnhMBL9L...
https://drmarcelosilva.com/tratamento-cirurgico-para-hemorr...
https://www.h9j.com.br/blog/cirurgia-para-hemorroida/
https://drcarlosobregon.com.br/cirurgia-de-hemorroida-fase-...
https://www.youtube.com/watch?v=cGQDvjhQ8wk
https://www.drbrunocoloproctologista.com/single-post/hemo...`;

console.log(extractUrlsFromString(csvStr));
