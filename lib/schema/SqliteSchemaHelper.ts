import { SchemaHelper } from './SchemaHelper';
import { EntityProperty } from '../decorators';

export class SqliteSchemaHelper extends SchemaHelper {

  static readonly TYPES = {
    number: 'integer',
    boolean: 'integer',
    date: 'text',
    string: 'text',
  };

  getSchemaBeginning(): string {
    return 'pragma foreign_keys = off;\n\n';
  }

  getSchemaEnd(): string {
    return 'pragma foreign_keys = on;\n';
  }

  getTypeDefinition(prop: EntityProperty): string {
    const t = prop.type.toLowerCase() as keyof typeof SqliteSchemaHelper.TYPES;
    return SqliteSchemaHelper.TYPES[t] || SqliteSchemaHelper.TYPES.string;
  }

  supportsSchemaConstraints(): boolean {
    return false;
  }

  supportsColumnAlter(): boolean {
    return false;
  }

  getListTablesSQL(): string {
    return `select name as table_name from sqlite_master where type = 'table' and name != 'sqlite_sequence' and name != 'geometry_columns' and name != 'spatial_ref_sys' union all select name from sqlite_temp_master where type = 'table' order by name`;
  }

}
