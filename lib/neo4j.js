import neo4j from 'neo4j-driver';

let _driver = null;

function getDriver() {
  if (!_driver && process.env.NEO4J_URI && process.env.NEO4J_USER && process.env.NEO4J_PASSWORD) {
    _driver = neo4j.driver(
      process.env.NEO4J_URI,
      neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASSWORD),
      { maxConnectionPoolSize: 10 }
    );
  }
  return _driver;
}

export function neo4jReady() {
  return !!(process.env.NEO4J_URI && process.env.NEO4J_USER && process.env.NEO4J_PASSWORD);
}

export async function runQuery(cypher, params = {}) {
  const driver = getDriver();
  if (!driver) throw new Error('Neo4j not configured');
  const session = driver.session();
  try {
    const result = await session.run(cypher, params);
    return result.records;
  } finally {
    await session.close();
  }
}

export async function initConstraints() {
  if (!neo4jReady()) return;
  try {
    await runQuery('CREATE CONSTRAINT doc_id IF NOT EXISTS FOR (d:Document) REQUIRE d.id IS UNIQUE');
    await runQuery('CREATE CONSTRAINT topic_name IF NOT EXISTS FOR (t:Topic) REQUIRE t.name IS UNIQUE');
    await runQuery('CREATE CONSTRAINT tech_name IF NOT EXISTS FOR (t:Technology) REQUIRE t.name IS UNIQUE');
    await runQuery('CREATE CONSTRAINT person_name IF NOT EXISTS FOR (p:Person) REQUIRE p.name IS UNIQUE');
    await runQuery('CREATE CONSTRAINT project_name IF NOT EXISTS FOR (p:Project) REQUIRE p.name IS UNIQUE');
    console.log('[neo4j] constraints initialised');
  } catch (err) {
    console.warn('[neo4j] constraint init failed:', err.message);
  }
}
