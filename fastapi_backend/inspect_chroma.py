import chromadb

client = chromadb.PersistentClient(path="chroma_data")

for collection_name in ["chunks", "chatroom_chunks"]:
    col = client.get_or_create_collection(collection_name)
    count = col.count()
    print(f"\n{'='*50}")
    print(f"Collection: {collection_name}  |  Total: {count}")
    print('='*50)

    if count == 0:
        print("  (empty — upload a file first)")
        continue

    results = col.peek(5)
    for i, doc_id in enumerate(results["ids"]):
        print(f"\n  --- Entry {i+1} ---")
        print(f"  ID:       {doc_id}")
        print(f"  Text:     {results['documents'][i][:200]}")
        print(f"  Metadata: {results['metadatas'][i]}")
        if results["embeddings"] is not None:
            emb = results["embeddings"][i]
            print(f"  Embedding dims: {len(emb)}  |  first 5: {emb[:5]}")
