import { initORMMySql, initORMPostgreSql, initORMSqlite } from './bootstrap';

/**
 * @class SchemaGeneratorTest
 */
describe('SchemaGenerator', () => {

  test('generate schema from metadata [mysql]', async () => {
    const orm = await initORMMySql();
    const generator = orm.getSchemaGenerator();
    const dump = await generator.generate();
    expect(dump).toMatchSnapshot('mysql-schema-dump');

    const ret = await generator.updateSchema();
    console.log(ret);

    await orm.close(true);
  });

  test('generate schema from metadata [sqlite]', async () => {
    const orm = await initORMSqlite();
    const generator = orm.getSchemaGenerator();
    const dump = await generator.generate();
    expect(dump).toMatchSnapshot('sqlite-schema-dump');

    const ret = await generator.updateSchema();
    console.log(ret);

    await orm.close(true);
  });

  test('generate schema from metadata [postgres]', async () => {
    const orm = await initORMPostgreSql();
    const generator = orm.getSchemaGenerator();
    const dump = await generator.generate();
    expect(dump).toMatchSnapshot('postgres-schema-dump');

    const ret = await generator.updateSchema();
    console.log(ret);

    await orm.close(true);
  });

});
