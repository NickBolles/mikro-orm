import { ColumnBuilder, ColumnInfo, SchemaBuilder, TableBuilder } from 'knex';
import { AbstractSqlDriver, Cascade, ReferenceType, Utils } from '..';
import { EntityMetadata, EntityProperty } from '../decorators';
import { Platform } from '../platforms';

interface TableDefinition {
  table_name: string;
}

export class SchemaGenerator {

  private readonly platform: Platform = this.driver.getPlatform();
  private readonly helper = this.platform.getSchemaHelper();
  private readonly connection = this.driver.getConnection();
  private readonly knex = this.connection.getKnex();

  constructor(private readonly driver: AbstractSqlDriver,
              private readonly metadata: Record<string, EntityMetadata>) { }

  async generate(): Promise<string> {
    let ret = await this.dropSchema(false, false);
    ret += await this.createSchema(false, false);

    return this.wrapSchema(ret);
  }

  async createSchema(run = false, wrap = true): Promise<string> {
    let ret = '';

    for (const meta of Object.values(this.metadata)) {
      ret += await this.dump(this.createTable(meta), run);
    }

    for (const meta of Object.values(this.metadata)) {
      ret += await this.dump(this.knex.schema.alterTable(meta.collection, table => this.createForeignKeys(table, meta)), run);
    }

    return this.wrapSchema(ret, wrap);
  }

  async dropSchema(run = false, wrap = true): Promise<string> {
    let ret = '';

    for (const meta of Object.values(this.metadata)) {
      ret += await this.dump(this.knex.schema.dropTableIfExists(meta.collection), run, '\n');
    }

    return this.wrapSchema(ret + '\n', wrap);
  }

  async updateSchema(run = false, wrap = true): Promise<string> {
    let ret = '';
    const tables = await this.connection.execute<TableDefinition[]>(this.helper.getListTablesSQL());

    for (const meta of Object.values(this.metadata)) {
      const hasTable = await this.knex.schema.hasTable(meta.collection);

      if (!hasTable) {
        ret += await this.dump(this.createTable(meta), run);
        ret += await this.dump(this.knex.schema.alterTable(meta.collection, table => this.createForeignKeys(table, meta)), run);

        continue;
      }

      const cols = await this.knex(meta.collection).columnInfo();
      const sql = await Utils.runSerial(this.updateTable(meta, cols), builder => this.dump(builder, run));
      ret += sql.join('\n');
    }

    const definedTables = Object.values(this.metadata).map(meta => meta.collection);
    const remove = tables.filter(table => !definedTables.includes(table.table_name));

    for (const table of remove) {
      ret += await this.dump(this.knex.schema.dropTable(table.table_name), run);
    }

    return this.wrapSchema(ret, wrap);
  }

  private async wrapSchema(sql: string, wrap = true): Promise<string> {
    if (!wrap) {
      return sql;
    }

    let ret = this.helper.getSchemaBeginning();
    ret += sql;
    ret += this.helper.getSchemaEnd();

    return ret;
  }

  private createTable(meta: EntityMetadata): SchemaBuilder {
    return this.knex.schema.createTable(meta.collection, table => {
      Object
        .values(meta.properties)
        .filter(prop => this.shouldHaveColumn(prop))
        .forEach(prop => this.createTableColumn(table, prop));
      this.helper.finalizeTable(table);
    });
  }

  private updateTable(meta: EntityMetadata, existingColumns: ColumnInfo): SchemaBuilder[] {
    const props = Object.values(meta.properties).filter(prop => this.shouldHaveColumn(prop));
    const create: EntityProperty[] = [];
    const update: EntityProperty[] = [];
    const columns = Object.keys(existingColumns);
    const remove = columns.filter(name => !props.find(prop => prop.fieldName === name));
    const ret: SchemaBuilder[] = [];

    for (const prop of props) {
      const col = columns.find(name => name === prop.fieldName);
      const column = existingColumns[col as keyof typeof existingColumns] as object as ColumnInfo;

      if (!col) {
        create.push(prop);
        continue;
      }

      // TODO check whether we need to update the column based on `cols`
      if (this.helper.supportsColumnAlter() && !this.helper.isSame(prop, column)) {
        update.push(prop);
      }
    }

    if (create.length + update.length === 0) {
      return ret;
    }

    ret.push(this.knex.schema.alterTable(meta.collection, table => {
      if (this.helper.supportsColumnAlter()) {
        table.dropPrimary();
      }

      const fks = update.filter(prop => prop.reference !== ReferenceType.SCALAR);
      fks.forEach(fk => table.dropForeign([fk.name]));
    }));

    ret.push(this.knex.schema.alterTable(meta.collection, table => {
      for (const prop of create) {
        this.createTableColumn(table, prop);
      }

      for (const prop of update) {
        this.updateTableColumn(table, prop);
      }

      if (remove.length > 0) {
        table.dropColumns(...remove);
      }
    }));

    return ret;
  }

  private shouldHaveColumn(prop: EntityProperty): boolean {
    if (prop.persist === false) {
      return false;
    }

    if (prop.reference === ReferenceType.SCALAR) {
      return true;
    }

    if (!this.helper.supportsSchemaConstraints()) {
      return false;
    }

    return prop.reference === ReferenceType.MANY_TO_ONE || (prop.reference === ReferenceType.ONE_TO_ONE && prop.owner);
  }

  private createTableColumn(table: TableBuilder, prop: EntityProperty, alter = false): ColumnBuilder {
    if (prop.primary && prop.type === 'number') {
      return table.increments(prop.fieldName);
    }

    const type = this.type(prop);
    const col = table.specificType(prop.fieldName, type);
    this.configureColumn(prop, col, alter);

    return col;
  }

  private updateTableColumn(table: TableBuilder, prop: EntityProperty, alter = false): ColumnBuilder {
    if (prop.primary) {
      table.dropPrimary();
    }

    return this.createTableColumn(table, prop, alter).alter();
  }

  private configureColumn(prop: EntityProperty, col: ColumnBuilder, alter: boolean) {
    const nullable = (alter && this.platform.requiresNullableForAlteringColumn()) || prop.nullable!;
    const indexed = prop.reference !== ReferenceType.SCALAR && this.helper.indexForeignKeys();
    const hasDefault = typeof prop.default !== 'undefined'; // support falsy default values like `0`, `false` or empty string

    Utils.runIfNotEmpty(() => col.unique(), prop.unique);
    Utils.runIfNotEmpty(() => col.nullable(), nullable);
    Utils.runIfNotEmpty(() => col.notNullable(), !nullable);
    Utils.runIfNotEmpty(() => col.primary(), prop.primary);
    Utils.runIfNotEmpty(() => col.unsigned(), this.isUnsigned(prop));
    Utils.runIfNotEmpty(() => col.index(), indexed);
    Utils.runIfNotEmpty(() => col.defaultTo(this.knex.raw('' + prop.default)), hasDefault);
  }

  private isUnsigned(prop: EntityProperty): boolean {
    if (prop.reference === ReferenceType.MANY_TO_ONE || prop.reference === ReferenceType.ONE_TO_ONE) {
      const meta2 = this.metadata[prop.type];
      const pk = meta2.properties[meta2.primaryKey];

      return pk.type === 'number';
    }

    return (prop.primary || prop.unsigned) && prop.type === 'number';
  }

  private createForeignKeys(table: TableBuilder, meta: EntityMetadata): void {
    Object.values(meta.properties)
      .filter(prop => prop.reference === ReferenceType.MANY_TO_ONE || (prop.reference === ReferenceType.ONE_TO_ONE && prop.owner))
      .forEach(prop => this.createForeignKey(table, prop));
  }

  private createForeignKey(table: TableBuilder, prop: EntityProperty): void {
    if (this.helper.supportsSchemaConstraints()) {
      this.createForeignKeyReference(table.foreign(prop.fieldName) as ColumnBuilder, prop);

      return;
    }

    const col = this.createTableColumn(table, prop, true);
    this.createForeignKeyReference(col, prop);
  }

  private createForeignKeyReference(col: ColumnBuilder, prop: EntityProperty): void {
    const meta2 = this.metadata[prop.type];
    const pk2 = meta2.properties[meta2.primaryKey];
    col.references(pk2.fieldName).inTable(meta2.collection);
    const cascade = prop.cascade.includes(Cascade.REMOVE) || prop.cascade.includes(Cascade.ALL);
    col.onDelete(cascade ? 'cascade' : 'set null');

    if (prop.cascade.includes(Cascade.PERSIST) || prop.cascade.includes(Cascade.ALL)) {
      col.onUpdate('cascade');
    }
  }

  private type(prop: EntityProperty): string {
    if (prop.reference === ReferenceType.SCALAR) {
      return this.helper.getTypeDefinition(prop);
    }

    const meta = this.metadata[prop.type];
    return this.helper.getTypeDefinition(meta.properties[meta.primaryKey]);
  }

  private async dump(builder: SchemaBuilder, run: boolean, append = '\n\n'): Promise<string> {
    if (run) {
      await builder;
    }

    const sql = builder.toQuery();

    return sql.length > 0 ? `${sql};${append}` : '';
  }

}
