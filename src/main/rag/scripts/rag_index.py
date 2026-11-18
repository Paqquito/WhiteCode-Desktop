"""Indexation d'un corpus dans ChromaDB.

Repris de l'approche d'Agentic Manager (Chroma + découpage récursif), avec
trois différences qui comptent à l'usage :

1. **Indexation incrémentale.** L'original efface toute la base à chaque
   passage et réencode l'intégralité du corpus. Sur quelques milliers de
   documents cela représente des dizaines de minutes pour un fichier modifié.
   Ici, l'empreinte (taille + date) de chaque fichier est conservée dans les
   métadonnées : seuls les fichiers nouveaux ou changés sont réencodés, et les
   fragments des fichiers disparus sont retirés.

2. **Écriture par lots.** L'original ajoute un fragment par appel. Chroma
   accepte des lots, et l'encodage vectoriel y est bien plus efficace.

3. **Extraction dans le même processus.** L'original lance un sous-processus
   Python par fichier. Le coût de démarrage dépasse largement celui de la
   lecture pour un fichier texte.

Appelé par l'application, jamais à la main. Le dialogue se fait en JSON sur la
sortie standard, une ligne par événement, pour que la progression soit
affichable pendant l'indexation.
"""

import argparse
import hashlib
import json
import os
import sys
from pathlib import Path

# Extensions lues directement. Le reste demande une bibliothèque dédiée, et
# n'est traité que si elle est présente.
TEXT_SUFFIXES = {
    ".txt", ".md", ".markdown", ".rst", ".log", ".csv", ".tsv",
    ".json", ".jsonl", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".env",
    ".py", ".js", ".jsx", ".ts", ".tsx", ".java", ".c", ".h", ".cpp", ".hpp",
    ".cs", ".go", ".rs", ".rb", ".php", ".swift", ".kt", ".scala", ".lua",
    ".sh", ".bash", ".zsh", ".ps1", ".psm1", ".bat", ".sql", ".r", ".m",
    ".html", ".htm", ".xml", ".css", ".scss", ".less", ".vue", ".svelte",
    ".tex", ".bib", ".adoc", ".org", ".properties", ".gradle", ".make",
}

# Formats demandant un traitement particulier. Listés à part pour que le
# rapport de fin puisse distinguer « format non pris en charge » de « format
# connu mais bibliothèque absente ».
STRUCTURED_SUFFIXES = {".ipynb", ".pdf", ".docx", ".pptx", ".odt"}

# Dossiers jamais parcourus : ils gonflent l'index sans rien apporter et
# ralentissent chaque passage.
SKIP_DIRS = {
    ".git", ".svn", ".hg", "node_modules", "__pycache__", ".venv", "venv",
    "dist", "build", "target", ".next", ".cache", ".idea", ".vscode",
    "site-packages", ".mypy_cache", ".pytest_cache", ".tox",
}

MAX_FILE_BYTES = 8 * 1024 * 1024

# Windows fait défaut à la page de code du système pour les flux standards :
# les accents des descriptions d'outils et des passages trouvés en sortiraient
# corrompus, et le protocole MCP est du JSON en UTF-8. On l'impose.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stdin.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")



def emit(kind, **fields):
    """Écrit un événement sur la sortie standard, immédiatement."""
    print(json.dumps({"event": kind, **fields}), flush=True)


def read_text(path: Path):
    """Contenu d'un fichier, ou None s'il n'est pas exploitable."""
    suffix = path.suffix.lower()

    if suffix in TEXT_SUFFIXES:
        try:
            raw = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            return None
        # Un octet nul trahit un binaire que l'extension n'annonçait pas.
        return None if "\x00" in raw[:4096] else raw

    if suffix == ".ipynb":
        # Un notebook est du JSON : le lire brut noierait le texte sous les
        # métadonnées et les sorties encodées en base64. On ne garde que le
        # code et le Markdown, dans l'ordre des cellules.
        try:
            notebook = json.loads(path.read_text(encoding="utf-8", errors="replace"))
        except (OSError, json.JSONDecodeError):
            return None
        parts = []
        for cell in notebook.get("cells", []):
            source = cell.get("source", "")
            text = "".join(source) if isinstance(source, list) else str(source)
            if not text.strip():
                continue
            kind = cell.get("cell_type", "")
            parts.append(f"# --- cellule {kind} ---\n{text}" if kind == "code" else text)
        return "\n\n".join(parts)

    if suffix == ".pdf":
        try:
            from pypdf import PdfReader
        except ImportError:
            return None
        try:
            reader = PdfReader(str(path))
            return "\n\n".join((page.extract_text() or "") for page in reader.pages)
        except Exception:
            return None

    if suffix == ".docx":
        try:
            import docx
        except ImportError:
            return None
        try:
            return "\n".join(p.text for p in docx.Document(str(path)).paragraphs)
        except Exception:
            return None

    return None


def fingerprint(path: Path) -> str:
    """Empreinte bon marché d'un fichier : taille et date de modification.

    Un hachage du contenu serait exact mais imposerait de relire tout le corpus
    à chaque passage — c'est précisément ce qu'on cherche à éviter.
    """
    stat = path.stat()
    return f"{stat.st_size}:{int(stat.st_mtime)}"


def chunk_text(text: str, size: int, overlap: int):
    """Découpe en fragments, en préférant les coupures naturelles.

    Réécrit plutôt qu'emprunté à langchain : la règle tient en vingt lignes et
    évite une dépendance de plus dans un environnement déjà lourd.
    """
    separators = ["\n\n", "\n", ". ", " "]
    chunks = []
    start = 0
    length = len(text)

    while start < length:
        end = min(start + size, length)
        if end < length:
            # Recule jusqu'à la dernière coupure propre du fragment, sans
            # descendre sous la moitié : mieux vaut couper au milieu d'une
            # phrase que produire un fragment minuscule.
            window = text[start:end]
            for separator in separators:
                cut = window.rfind(separator)
                if cut > size // 2:
                    end = start + cut + len(separator)
                    break
        piece = text[start:end].strip()
        if piece:
            chunks.append(piece)
        if end <= start:
            break
        start = max(end - overlap, end) if overlap >= size else end - overlap
    return chunks


def walk(root: Path):
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS and not d.startswith(".")]
        for name in filenames:
            path = Path(dirpath) / name
            try:
                if path.stat().st_size > MAX_FILE_BYTES:
                    continue
            except OSError:
                continue
            yield path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--store", required=True)
    parser.add_argument("--collection", default="corpus")
    parser.add_argument("--chunk-size", type=int, default=1000)
    parser.add_argument("--chunk-overlap", type=int, default=200)
    parser.add_argument("--embedding", default="")
    parser.add_argument("--reset", action="store_true")
    args = parser.parse_args()

    source = Path(args.source)
    if not source.is_dir():
        emit("error", message=f"Dossier introuvable : {source}")
        return 1

    import chromadb
    from chromadb.utils import embedding_functions

    if args.embedding:
        # Modèle explicite : passe par sentence-transformers, plus précis en
        # multilingue mais nettement plus lourd à installer.
        embedder = embedding_functions.SentenceTransformerEmbeddingFunction(
            model_name=args.embedding
        )
    else:
        # Par défaut, le modèle ONNX embarqué avec Chroma : quelques dizaines
        # de mégaoctets contre plusieurs gigaoctets pour torch, et suffisant
        # pour de la recherche documentaire.
        embedder = embedding_functions.DefaultEmbeddingFunction()

    client = chromadb.PersistentClient(path=args.store)
    if args.reset:
        try:
            client.delete_collection(args.collection)
        except Exception:
            pass
    collection = client.get_or_create_collection(
        name=args.collection, embedding_function=embedder
    )

    # État connu, relu une seule fois : un aller-retour par fichier coûterait
    # plus cher que de tout charger.
    known = {}
    existing = collection.get(include=["metadatas"])
    for chunk_id, meta in zip(existing["ids"], existing["metadatas"]):
        known.setdefault(meta.get("source", ""), {"fingerprint": meta.get("fingerprint"), "ids": []})
        known[meta.get("source", "")]["ids"].append(chunk_id)

    files = list(walk(source))
    emit("start", files=len(files))

    seen = set()
    indexed = 0
    skipped = 0
    total_chunks = 0
    # Comptage des refus par extension : c'est la seule façon d'expliquer un
    # « 0 document » autrement que par une panne. Un dossier de notebooks, de
    # PDF ou d'images ne produit rien, et il faut le dire plutôt que de laisser
    # deviner.
    ignored = {}
    unreadable = {}

    for position, path in enumerate(files, 1):
        key = str(path)
        seen.add(key)
        try:
            stamp = fingerprint(path)
        except OSError:
            continue

        entry = known.get(key)
        if entry and entry["fingerprint"] == stamp:
            skipped += 1
            continue

        text = read_text(path)
        if not text or not text.strip():
            suffix = path.suffix.lower() or "(sans extension)"
            bucket = unreadable if suffix in STRUCTURED_SUFFIXES else ignored
            bucket[suffix] = bucket.get(suffix, 0) + 1
            continue

        # Le fichier a changé : ses anciens fragments ne valent plus rien.
        if entry:
            collection.delete(ids=entry["ids"])

        chunks = chunk_text(text, args.chunk_size, args.chunk_overlap)
        if not chunks:
            continue

        digest = hashlib.sha1(key.encode("utf-8")).hexdigest()[:16]
        collection.add(
            documents=chunks,
            ids=[f"{digest}:{i}" for i in range(len(chunks))],
            metadatas=[
                {
                    "source": key,
                    "file_name": path.name,
                    "chunk_index": i,
                    "total_chunks": len(chunks),
                    "fingerprint": stamp,
                }
                for i in range(len(chunks))
            ],
        )
        indexed += 1
        total_chunks += len(chunks)
        emit("file", path=key, chunks=len(chunks), position=position, total=len(files))

    # Fichiers disparus du disque : leurs fragments répondraient encore aux
    # recherches, en citant des sources qui n'existent plus.
    removed = 0
    for key, entry in known.items():
        if key and key not in seen:
            collection.delete(ids=entry["ids"])
            removed += 1

    emit(
        "done",
        indexed=indexed,
        skipped=skipped,
        removed=removed,
        chunks=total_chunks,
        total_in_store=collection.count(),
        # Trié par nombre décroissant : ce qui domine le dossier explique le
        # mieux pourquoi l'indexation a rendu peu de choses.
        ignored=dict(sorted(ignored.items(), key=lambda kv: -kv[1])[:8]),
        unreadable=dict(sorted(unreadable.items(), key=lambda kv: -kv[1])[:8]),
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
