"""Serveur MCP exposant un corpus indexé.

Parle le protocole MCP sur l'entrée et la sortie standard, sans dépendance :
le protocole tient en trois messages — `initialize`, `tools/list`, `tools/call`
— et écrire ces trente lignes évite d'imposer `fastmcp` dans un environnement
Python déjà chargé par Chroma.

## Ce qui diffère de l'implémentation d'Agentic Manager

**Le filtre de pertinence était inversé.** Chroma rend des *distances* : plus
la valeur est basse, plus le fragment est proche de la question. Le code
d'origine gardait les fragments dont la distance dépassait `min_score`, donc
exactement les moins pertinents, et écartait les meilleurs. Ici la distance est
convertie en similarité (`1 - distance`) avant d'être comparée.

**La recherche par mots-clés ne parcourt plus toute la base.** L'original
rapatriait l'intégralité des fragments dans Python, par lots de cinq cents,
pour y chercher une sous-chaîne — à chaque requête. Chroma sait filtrer sur le
contenu (`where_document`), et le fait dans son index.
"""

import argparse
import json
import os
import sys

TOOLS = [
    {
        "name": "search",
        "description": (
            "Recherche sémantique dans le corpus indexé. Rend les passages les "
            "plus proches de la question, avec leur fichier d'origine. À "
            "utiliser pour toute question portant sur le contenu du corpus."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "La question, en langage naturel."},
                "limit": {"type": "integer", "default": 6, "description": "Nombre de passages."},
                "min_score": {
                    "type": "number",
                    "default": 0.15,
                    "description": "Similarité minimale, de 0 (tout) à 1 (identique).",
                },
            },
            "required": ["query"],
        },
    },
    {
        "name": "grep",
        "description": (
            "Recherche une expression littérale dans le corpus. Complémentaire "
            "de la recherche sémantique : à préférer pour un identifiant, un "
            "code d'erreur ou un nom de fonction, que les vecteurs situent mal."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "text": {"type": "string"},
                "limit": {"type": "integer", "default": 10},
            },
            "required": ["text"],
        },
    },
    {
        "name": "read_document",
        "description": (
            "Rend le contenu complet d'un document indexé, à partir de son "
            "chemin tel que rendu par les recherches."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {"source": {"type": "string"}},
            "required": ["source"],
        },
    },
    {
        "name": "list_documents",
        "description": "Liste les documents du corpus. Pour explorer ce qu'il contient.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "limit": {"type": "integer", "default": 50},
                "offset": {"type": "integer", "default": 0},
            },
        },
    },
]

MAX_CHARS = 24000

# Windows fait défaut à la page de code du système pour les flux standards :
# les accents des descriptions d'outils et des passages trouvés en sortiraient
# corrompus, et le protocole MCP est du JSON en UTF-8. On l'impose.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stdin.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")



class Corpus:
    """Accès paresseux à la base.

    Chroma et son modèle d'encodage mettent plusieurs secondes à s'initialiser.
    Les charger à l'ouverture retarderait le démarrage du moteur, qui interroge
    tous ses serveurs MCP avant le premier tour ; les charger au premier appel
    reporte ce coût sur une recherche, où il passe inaperçu.
    """

    def __init__(self, store, collection, embedding):
        self.store = store
        self.name = collection
        self.embedding = embedding
        self._collection = None

    @property
    def collection(self):
        if self._collection is None:
            import chromadb
            from chromadb.utils import embedding_functions

            if self.embedding:
                embedder = embedding_functions.SentenceTransformerEmbeddingFunction(
                    model_name=self.embedding
                )
            else:
                embedder = embedding_functions.DefaultEmbeddingFunction()
            client = chromadb.PersistentClient(path=self.store)
            self._collection = client.get_or_create_collection(
                name=self.name, embedding_function=embedder
            )
        return self._collection


def search(corpus, query, limit=6, min_score=0.15):
    results = corpus.collection.query(query_texts=[query], n_results=max(limit * 3, 10))
    documents = results["documents"][0]
    metadatas = results["metadatas"][0]
    distances = results["distances"][0]

    hits = []
    for document, meta, distance in zip(documents, metadatas, distances):
        # Chroma rend une distance : proche de 0 = très pertinent. La convertir
        # en similarité rend le seuil lisible et va dans le bon sens.
        similarity = 1.0 - float(distance)
        if similarity < min_score:
            continue
        hits.append(
            {
                "source": meta.get("source", ""),
                "file": meta.get("file_name", ""),
                "chunk": meta.get("chunk_index", 0),
                "score": round(similarity, 3),
                "text": document,
            }
        )
        if len(hits) >= limit:
            break

    if not hits:
        return "Aucun passage pertinent. Reformuler, ou baisser `min_score`."

    parts = []
    for hit in hits:
        parts.append(
            f"--- {hit['source']} (fragment {hit['chunk']}, similarité {hit['score']}) ---\n{hit['text']}"
        )
    return "\n\n".join(parts)[:MAX_CHARS]


def grep(corpus, text, limit=10):
    # `where_document` filtre dans l'index de Chroma, sans rapatrier le corpus.
    results = corpus.collection.get(
        where_document={"$contains": text},
        include=["documents", "metadatas"],
        limit=limit,
    )
    if not results["documents"]:
        return f"Aucune occurrence de « {text} »."
    parts = []
    for document, meta in zip(results["documents"], results["metadatas"]):
        parts.append(f"--- {meta.get('source', '')} ---\n{document}")
    return "\n\n".join(parts)[:MAX_CHARS]


def read_document(corpus, source):
    results = corpus.collection.get(
        where={"source": source}, include=["documents", "metadatas"]
    )
    if not results["documents"]:
        return f"Document absent du corpus : {source}"
    ordered = sorted(
        zip(results["documents"], results["metadatas"]),
        key=lambda pair: pair[1].get("chunk_index", 0),
    )
    return "\n".join(document for document, _ in ordered)[:MAX_CHARS]


def list_documents(corpus, limit=50, offset=0):
    results = corpus.collection.get(include=["metadatas"])
    sources = {}
    for meta in results["metadatas"]:
        source = meta.get("source", "")
        if source and source not in sources:
            sources[source] = meta.get("total_chunks", 1)
    items = sorted(sources.items())[offset : offset + limit]
    if not items:
        return "Corpus vide."
    lines = [f"{len(sources)} document(s) indexé(s) :"]
    lines += [f"  {source}  ({count} fragments)" for source, count in items]
    return "\n".join(lines)


def call(corpus, name, arguments):
    if name == "search":
        return search(
            corpus,
            arguments["query"],
            int(arguments.get("limit", 6)),
            float(arguments.get("min_score", 0.15)),
        )
    if name == "grep":
        return grep(corpus, arguments["text"], int(arguments.get("limit", 10)))
    if name == "read_document":
        return read_document(corpus, arguments["source"])
    if name == "list_documents":
        return list_documents(
            corpus, int(arguments.get("limit", 50)), int(arguments.get("offset", 0))
        )
    raise ValueError(f"Outil inconnu : {name}")


def respond(message_id, result=None, error=None):
    payload = {"jsonrpc": "2.0", "id": message_id}
    if error is not None:
        payload["error"] = error
    else:
        payload["result"] = result
    sys.stdout.write(json.dumps(payload) + "\n")
    sys.stdout.flush()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--store", required=True)
    parser.add_argument("--collection", default="corpus")
    parser.add_argument("--embedding", default="")
    parser.add_argument("--label", default="corpus")
    args = parser.parse_args()

    corpus = Corpus(args.store, args.collection, args.embedding)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            message = json.loads(line)
        except json.JSONDecodeError:
            continue

        method = message.get("method")
        message_id = message.get("id")

        # Les notifications n'attendent pas de réponse ; en envoyer une
        # ferait échouer l'analyse côté client.
        if message_id is None:
            continue

        if method == "initialize":
            respond(
                message_id,
                {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {"tools": {}},
                    "serverInfo": {"name": f"rag-{args.label}", "version": "1.0.0"},
                },
            )
        elif method == "tools/list":
            respond(message_id, {"tools": TOOLS})
        elif method == "tools/call":
            params = message.get("params", {})
            try:
                text = call(corpus, params.get("name", ""), params.get("arguments", {}))
                respond(message_id, {"content": [{"type": "text", "text": text}]})
            except Exception as error:  # noqa: BLE001
                respond(
                    message_id,
                    {
                        "content": [{"type": "text", "text": f"Erreur : {error}"}],
                        "isError": True,
                    },
                )
        else:
            respond(message_id, error={"code": -32601, "message": f"Méthode inconnue : {method}"})


if __name__ == "__main__":
    main()
