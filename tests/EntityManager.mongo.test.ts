import { ObjectID } from 'mongodb';
import { Collection, Configuration, EntityManager, MikroORM, QueryOrder } from '../lib';
import { EntityProperty } from '../lib/decorators';
import { Author, Book, BookTag, Publisher, PublisherType, Test } from './entities';
import { AuthorRepository } from './repositories/AuthorRepository';
import { initORM, wipeDatabase } from './bootstrap';
import { MongoDriver } from '../lib/drivers/MongoDriver';
import { MongoConnection } from '../lib/connections/MongoConnection';
import { Logger } from '../lib/utils';
import { FooBar } from './entities/FooBar';
import { FooBaz } from './entities/FooBaz';

/**
 * @class EntityManagerMongoTest
 */
describe('EntityManagerMongo', () => {

  let orm: MikroORM;

  beforeAll(async () => orm = await initORM());
  beforeEach(async () => wipeDatabase(orm.em));

  test('should load entities', async () => {
    expect(orm).toBeInstanceOf(MikroORM);
    expect(orm.em).toBeInstanceOf(EntityManager);

    const god = new Author('God', 'hello@heaven.god');
    const bible = new Book('Bible', god);
    await orm.em.persistAndFlush(bible);

    const author = new Author('Jon Snow', 'snow@wall.st');
    author.born = new Date();
    author.favouriteBook = bible;

    const publisher = new Publisher('7K publisher', PublisherType.GLOBAL);

    const book1 = new Book('My Life on The Wall, part 1', author);
    book1.publisher = publisher;
    const book2 = new Book('My Life on The Wall, part 2', author);
    book2.publisher = publisher;
    const book3 = new Book('My Life on The Wall, part 3', author);
    book3.publisher = publisher;

    const repo = orm.em.getRepository(Book);
    repo.persistLater(book1);
    repo.persistLater(book2);
    repo.persistLater(book3);
    await repo.flush();
    orm.em.clear();

    const publisher7k = (await orm.em.getRepository(Publisher).findOne({ name: '7K publisher' }))!;
    expect(publisher7k).not.toBeNull();
    expect(publisher7k.tests).toBeInstanceOf(Collection);
    expect(publisher7k.tests.isInitialized()).toBe(true);
    orm.em.clear();

    const authorRepository = orm.em.getRepository(Author);
    const booksRepository = orm.em.getRepository(Book);
    const books = await booksRepository.findAll(['author']);
    expect(books[0].author.isInitialized()).toBe(true);
    expect(await authorRepository.findOne({ favouriteBook: bible._id })).not.toBe(null);
    orm.em.clear();

    const noBooks = await booksRepository.find({ title: 'not existing' }, ['author']);
    expect(noBooks.length).toBe(0);
    orm.em.clear();

    const jon = (await authorRepository.findOne({ name: 'Jon Snow' }, ['books', 'favouriteBook']))!;
    const authors = await authorRepository.findAll(['books', 'favouriteBook']);
    expect(await authorRepository.findOne({ email: 'not existing' })).toBeNull();

    // count test
    const count = await authorRepository.count();
    expect(count).toBe(authors.length);

    // identity map test
    authors.shift(); // shift the god away, as that entity is detached from IM
    expect(jon).toBe(authors[0]);
    expect(jon).toBe(await authorRepository.findOne(jon.id));
    expect(jon).toBe(await authorRepository.findOne(jon._id));

    // serialization test
    const o = jon.toJSON(false);
    expect(o).toMatchObject({
      id: jon.id,
      createdAt: jon.createdAt,
      updatedAt: jon.updatedAt,
      books: [
        { author: jon.id, publisher: publisher.id, title: 'My Life on The Wall, part 1' },
        { author: jon.id, publisher: publisher.id, title: 'My Life on The Wall, part 2' },
        { author: jon.id, publisher: publisher.id, title: 'My Life on The Wall, part 3' },
      ],
      favouriteBook: { author: god.id, title: 'Bible' },
      born: jon.born,
      name: 'Jon Snow',
      foo: 'bar',
    });
    expect(jon.toJSON(false)).toEqual(o);
    expect(jon.books.getIdentifiers('_id')).toBeInstanceOf(Array);
    expect(jon.books.getIdentifiers('_id')[0]).toBeInstanceOf(ObjectID);
    expect(jon.books.getIdentifiers()).toBeInstanceOf(Array);
    expect(typeof jon.books.getIdentifiers('id')[0]).toBe('string');

    for (const author of authors) {
      expect(author.books).toBeInstanceOf(Collection);
      expect(author.books.isInitialized()).toBe(true);

      // iterator test
      for (const book of author.books) {
        expect(book.title).toMatch(/My Life on The Wall, part \d/);
        expect(book.author).toBeInstanceOf(Author);
        expect(book.author.isInitialized()).toBe(true);
        expect(book.publisher).toBeInstanceOf(Publisher);
        expect(book.publisher.isInitialized()).toBe(false);
      }
    }

    const booksByTitleAsc = await booksRepository.find({ author: jon._id }, [], { title: QueryOrder.ASC });
    expect(booksByTitleAsc[0].title).toBe('My Life on The Wall, part 1');
    expect(booksByTitleAsc[1].title).toBe('My Life on The Wall, part 2');
    expect(booksByTitleAsc[2].title).toBe('My Life on The Wall, part 3');

    const booksByTitleDesc = await booksRepository.find({ author: jon.id }, [], { title: 'desc' });
    expect(booksByTitleDesc[0].title).toBe('My Life on The Wall, part 3');
    expect(booksByTitleDesc[1].title).toBe('My Life on The Wall, part 2');
    expect(booksByTitleDesc[2].title).toBe('My Life on The Wall, part 1');

    const twoBooks = await booksRepository.find({ author: jon._id }, [], { title: 'DESC' }, 2);
    expect(twoBooks.length).toBe(2);
    expect(twoBooks[0].title).toBe('My Life on The Wall, part 3');
    expect(twoBooks[1].title).toBe('My Life on The Wall, part 2');

    const lastBook = await booksRepository.find({ author: jon.id }, ['author'], { title: -1 }, 2, 2);
    expect(lastBook.length).toBe(1);
    expect(lastBook[0].title).toBe('My Life on The Wall, part 1');
    expect(lastBook[0].author).toBeInstanceOf(Author);
    expect(lastBook[0].author.isInitialized()).toBe(true);

    const lastBook2 = await booksRepository.find({ author: jon.id }, {
      populate: ['author'],
      orderBy: { title: QueryOrder.DESC },
      limit: 2,
      offset: 2,
    });
    expect(lastBook2.length).toBe(1);
    expect(lastBook[0]).toBe(lastBook2[0]);

    const lastBook3 = await orm.em.find(Book, { author: jon.id }, {
      populate: ['author'],
      orderBy: { title: QueryOrder.DESC },
      limit: 2,
      offset: 2,
    });
    expect(lastBook3.length).toBe(1);
    expect(lastBook[0]).toBe(lastBook3[0]);

    await orm.em.getRepository(Book).remove(lastBook[0]._id);
  });

  test('should provide custom repository', async () => {
    const repo = orm.em.getRepository(Author) as AuthorRepository;
    expect(repo).toBeInstanceOf(AuthorRepository);
    expect(repo.magic).toBeInstanceOf(Function);
    expect(repo.magic('test')).toBe('111 test 222');
  });

  test('findOne should work with options parameter', async () => {
    const repo = orm.em.getRepository(Author) as AuthorRepository;
    const author = new Author('name 1', 'email');
    const author2 = new Author('name 2', 'email');
    await repo.persist([author, author2]);
    orm.em.clear();

    const a2 = await repo.findOne({ name: /^name/ }, {
      populate: ['books'],
      orderBy: { name: QueryOrder.DESC },
    });
    expect(a2).not.toBeNull();
    expect(a2!.id).toBe(author2.id);
    expect(a2!.books.isInitialized()).toBe(true);

    const a1 = await repo.findOne({ name: /^name/ }, {
      orderBy: { name: QueryOrder.ASC },
    });
    expect(a1).not.toBeNull();
    expect(a1!.id).toBe(author.id);
    expect(a1!.books.isInitialized()).toBe(false);

    const a3 = await repo.findOne({ name: /^name/ }, [], { name: QueryOrder.ASC });
    expect(a3).toBe(a1);
  });

  test('should convert entity to PK when trying to search by entity', async () => {
    const repo = orm.em.getRepository(Author) as AuthorRepository;
    const author = new Author('name', 'email');
    await repo.persist(author);
    const a = await repo.findOne(author);
    const authors = await repo.find({ id: author });
    expect(a).toBe(author);
    expect(authors[0]).toBe(author);
  });

  test('removing not yet persisted entity will not make db call', async () => {
    const author = new Author('name', 'email');
    const author2 = new Author('name2', 'email2');
    const author3 = new Author('name3', 'email3');
    const repo = orm.em.getRepository(Author) as AuthorRepository;
    repo.persistLater(author);
    repo.persistLater(author2);
    await repo.removeAndFlush(author);
    expect(Object.keys(orm.em.getUnitOfWork().getIdentityMap())).toEqual([`Author-${author2.id}`]);
    author2.name = 'lol';
    repo.persistLater(author2);
    orm.em.removeLater(author3);
    await repo.flush();
    await orm.em.remove(Author, author3);
  });

  test('removing persisted entity will remove it from persist stack first', async () => {
    const author = new Author('name', 'email');
    const repo = orm.em.getRepository(Author) as AuthorRepository;
    await repo.persist(author);
    expect(orm.em.getUnitOfWork().getById(Author.name, author.id)).toBeDefined();
    author.name = 'new name';
    await repo.persist(author, false);
    await orm.em.removeEntity(author, false);
    expect(orm.em.getUnitOfWork().getById(Author.name, author.id)).toBeUndefined();
    expect(orm.em.getUnitOfWork().getIdentityMap()).toEqual({});
  });

  test('removing persisted entity via PK', async () => {
    const author = new Author('name', 'email');
    const repo = orm.em.getRepository(Author) as AuthorRepository;
    await repo.persist(author);
    orm.em.clear();

    const mock = jest.fn();
    const logger = new Logger(mock, true);
    Object.assign(orm.em.getConnection(), { logger });
    await orm.em.remove(Author, author.id);
    expect(mock.mock.calls[0][0]).toMatch(/db\.getCollection\("author"\)\.deleteMany\({"_id":"\w+"}\)/);
  });

  test('should throw when trying to merge entity without id', async () => {
    const author = new Author('test', 'test');
    expect(() => orm.em.merge(author)).toThrowError(`You cannot merge entity 'Author' without identifier!`);
  });

  test('fork', async () => {
    const god = new Author('God', 'hello@heaven.god');
    const bible = new Book('Bible', god);
    await orm.em.persist(bible);
    const fork = orm.em.fork();

    expect(fork).not.toBe(orm.em);
    expect(fork['metadata']).toBe(orm.em['metadata']);
    expect(fork.getUnitOfWork().getIdentityMap()).toEqual({});

    // request context is not started so we can use UoW and EF getters
    expect(fork.getUnitOfWork().getIdentityMap()).not.toBe(orm.em.getUnitOfWork().getIdentityMap());
    expect(fork.getEntityFactory()).not.toBe(orm.em.getEntityFactory());
  });

  test('findOne with empty where will throw', async () => {
    await expect(orm.em.findOne(Author, '')).rejects.toThrowError(`You cannot call 'EntityManager.findOne()' with empty 'where' parameter`);
    await expect(orm.em.findOne(Author, {})).rejects.toThrowError(`You cannot call 'EntityManager.findOne()' with empty 'where' parameter`);
    await expect(orm.em.findOne(Author, [])).rejects.toThrowError(`You cannot call 'EntityManager.findOne()' with empty 'where' parameter`);
    await expect(orm.em.findOne(Author, undefined!)).rejects.toThrowError(`You cannot call 'EntityManager.findOne()' with empty 'where' parameter`);
    await expect(orm.em.findOne(Author, null!)).rejects.toThrowError(`You cannot call 'EntityManager.findOne()' with empty 'where' parameter`);
  });

  test('findOne should initialize entity that is already in IM', async () => {
    const god = new Author('God', 'hello@heaven.god');
    const bible = new Book('Bible', god);
    await orm.em.persist(bible);
    orm.em.clear();

    const ref = orm.em.getReference(Author, god.id);
    expect(ref.isInitialized()).toBe(false);
    const newGod = await orm.em.findOne(Author, god.id);
    expect(ref).toBe(newGod);
    expect(ref.isInitialized()).toBe(true);
  });

  test('findOne supports regexps', async () => {
    const author1 = new Author('Author 1', 'a1@example.com');
    const author2 = new Author('Author 2', 'a2@example.com');
    const author3 = new Author('Author 3', 'a3@example.com');
    await orm.em.persist([author1, author2, author3]);
    orm.em.clear();

    const authors = await orm.em.find(Author, { email: /example\.com$/ });
    expect(authors.length).toBe(3);
    expect(authors[0].name).toBe('Author 1');
    expect(authors[1].name).toBe('Author 2');
    expect(authors[2].name).toBe('Author 3');
  });

  test('stable results of serialization', async () => {
    const god = new Author('God', 'hello@heaven.god');
    const bible = new Book('Bible', god);
    const bible2 = new Book('Bible pt. 2', god);
    const bible3 = new Book('Bible pt. 3', new Author('Lol', 'lol@lol.lol'));
    await orm.em.persist([bible, bible2, bible3]);
    orm.em.clear();

    const newGod = (await orm.em.findOne(Author, god.id))!;
    const books = await orm.em.find(Book, {});
    await newGod.init(false);

    for (const book of books) {
      expect(book.toJSON()).toMatchObject({
        author: book.author.id,
      });
    }
  });

  test('stable results of serialization (collection)', async () => {
    const pub = new Publisher('Publisher2');
    await orm.em.persist(pub);
    const god = new Author('God', 'hello@heaven.god');
    const bible = new Book('Bible', god);
    bible.publisher = pub;
    const bible2 = new Book('Bible pt. 2', god);
    bible2.publisher = pub;
    const bible3 = new Book('Bible pt. 3', new Author('Lol', 'lol@lol.lol'));
    bible3.publisher = pub;
    await orm.em.persist([bible, bible2, bible3]);
    orm.em.clear();

    const newGod = orm.em.getReference(Author, god.id);
    const publisher = (await orm.em.findOne(Publisher, pub.id, ['books']))!;
    await newGod.init();

    const json = publisher.toJSON().books;

    for (const book of publisher.books) {
      expect(json.find((b: Book) => b.id === book.id)).toMatchObject({
        author: book.author.id,
      });
    }
  });

  test('should return mongo driver', async () => {
    const driver = orm.em.getDriver<MongoDriver>();
    expect(driver instanceof MongoDriver).toBe(true);
    expect(await driver.findOne(BookTag.name, { foo: 'bar', books: 123 })).toBeNull();
    expect(driver.getPlatform().usesPivotTable()).toBe(false);
    expect(driver.getPlatform().requiresNullableForAlteringColumn()).toBe(false); // test default Platform value (not used by mongo)
    await expect(driver.loadFromPivotTable({} as EntityProperty, [])).rejects.toThrowError('MongoDriver does not use pivot tables');
    expect(() => driver.getPlatform().getSchemaHelper()).toThrowError('MongoPlatform does not provide SchemaHelper');
    await expect(driver.getConnection().execute('')).rejects.toThrowError('MongoConnection does not support generic execute method');
    expect(driver.getConnection().getCollection(BookTag).collectionName).toBe('book-tag');
    expect(driver.getConnection().getCollection(BookTag.name).collectionName).toBe('book-tag');
  });

  test('should use user and password as connection options', async () => {
    const config = new Configuration({ user: 'usr', password: 'pw' } as any, false);
    const connection = new MongoConnection(config);
    await expect(connection.getConnectionOptions()).toEqual({
      useNewUrlParser: true,
      auth: { user: 'usr', password: 'pw' },
    });
  });

  test('connection returns correct URL', async () => {
    const conn1 = new MongoConnection(new Configuration({
      clientUrl: 'mongodb://example.host.com:34500',
      dbName: 'test-db-name',
      user: 'usr',
      password: 'pw',
    } as any, false));
    await expect(conn1.getClientUrl()).toBe('mongodb://usr:*****@example.host.com:34500');
    const conn2 = new MongoConnection(new Configuration({ type: 'mongo' } as any, false));
    await expect(conn2.getClientUrl()).toBe('mongodb://127.0.0.1:27017');
    const clientUrl = 'mongodb://user:Q#ais@2d-Aa_43:ui!0d.ai6d@mongodb-replicaset-0.cluster.local:27017,mongodb-replicaset-1.cluster.local:27018,...';
    const conn3 = new MongoConnection(new Configuration({ type: 'mongo', clientUrl } as any, false));
    await expect(conn3.getClientUrl()).toBe('mongodb://user:*****@mongodb-replicaset-0.cluster.local:27017,mongodb-replicaset-1.cluster.local:27018,...');
    const conn4 = new MongoConnection(new Configuration({ type: 'mongo', clientUrl: 'invalid-url-that-was-not-properly-parsed' } as any, false));
    await expect(conn4.getClientUrl()).toBe('invalid-url-that-was-not-properly-parsed');
  });

  test('findOne by id', async () => {
    const authorRepository = orm.em.getRepository(Author);
    const jon = new Author('Jon Snow', 'snow@wall.st');
    await authorRepository.persist(jon);

    orm.em.clear();
    let author = (await authorRepository.findOne(jon._id))!;
    expect(author).not.toBeNull();
    expect(author.name).toBe('Jon Snow');

    orm.em.clear();
    author = (await authorRepository.findOne(jon.id))!;
    expect(author).not.toBeNull();
    expect(author.name).toBe('Jon Snow');

    orm.em.clear();
    author = (await authorRepository.findOne({ id: jon.id }))!;
    expect(author).not.toBeNull();
    expect(author.name).toBe('Jon Snow');

    orm.em.clear();
    author = (await authorRepository.findOne({ _id: jon._id }))!;
    expect(author).not.toBeNull();
    expect(author.name).toBe('Jon Snow');
  });

  test('populate ManyToOne relation', async () => {
    const authorRepository = orm.em.getRepository(Author);
    const god = new Author('God', 'hello@heaven.god');
    const bible = new Book('Bible', god);
    await orm.em.persist(bible);

    let jon = new Author('Jon Snow', 'snow@wall.st');
    jon.born = new Date();
    jon.favouriteBook = bible;
    await orm.em.persist(jon);
    orm.em.clear();

    jon = (await authorRepository.findOne(jon.id))!;
    expect(jon).not.toBeNull();
    expect(jon.name).toBe('Jon Snow');
    expect(jon.favouriteBook).toBeInstanceOf(Book);
    expect(jon.favouriteBook.isInitialized()).toBe(false);

    await jon.favouriteBook.init();
    expect(jon.favouriteBook).toBeInstanceOf(Book);
    expect(jon.favouriteBook.isInitialized()).toBe(true);
    expect(jon.favouriteBook.title).toBe('Bible');
  });

  test('many to many relation', async () => {
    const author = new Author('Jon Snow', 'snow@wall.st');
    const book1 = new Book('My Life on The Wall, part 1', author);
    const book2 = new Book('My Life on The Wall, part 2', author);
    const book3 = new Book('My Life on The Wall, part 3', author);
    const tag1 = new BookTag('silly');
    const tag2 = new BookTag('funny');
    const tag3 = new BookTag('sick');
    const tag4 = new BookTag('strange');
    const tag5 = new BookTag('sexy');
    book1.tags.add(tag1, tag3, tag3);
    book2.tags.add(tag1, tag2, tag5);
    book3.tags.add(tag2, tag4, tag5);

    await orm.em.persist(book1, false);
    await orm.em.persist(book2, false);
    await orm.em.persist(book3);

    expect(tag1._id).toBeDefined();
    expect(tag2._id).toBeDefined();
    expect(tag3._id).toBeDefined();
    expect(tag4._id).toBeDefined();
    expect(tag5._id).toBeDefined();
    expect(book1.tags.toArray()).toEqual([tag1.toJSON(), tag3.toJSON()]);

    // test inverse side
    const tagRepository = orm.em.getRepository(BookTag);
    let tags = await tagRepository.findAll();
    expect(tags).toBeInstanceOf(Array);
    expect(tags.length).toBe(5);
    expect(tags[0]).toBeInstanceOf(BookTag);
    expect(tags[0].name).toBe('silly');
    expect(tags[0].books).toBeInstanceOf(Collection);
    expect(tags[0].books.isInitialized()).toBe(true);
    expect(tags[0].books.isDirty()).toBe(false);
    expect(tags[0].books.count()).toBe(2);
    expect(tags[0].books.length).toBe(2);

    orm.em.clear();
    tags = await orm.em.find(BookTag);
    expect(tags[0].books.isInitialized()).toBe(false);
    expect(tags[0].books.isDirty()).toBe(false);
    expect(() => tags[0].books.getItems()).toThrowError(/Collection Book\[] of entity BookTag\[\w{24}] not initialized/);
    expect(() => tags[0].books.add(book1)).toThrowError(/Collection Book\[] of entity BookTag\[\w{24}] not initialized/);
    expect(() => tags[0].books.remove(book1, book2)).toThrowError(/Collection Book\[] of entity BookTag\[\w{24}] not initialized/);
    expect(() => tags[0].books.removeAll()).toThrowError(/Collection Book\[] of entity BookTag\[\w{24}] not initialized/);
    expect(() => tags[0].books.contains(book1)).toThrowError(/Collection Book\[] of entity BookTag\[\w{24}] not initialized/);

    // test M:N lazy init
    orm.em.clear();
    await tags[0].books.init();
    expect(tags[0].books.count()).toBe(2);
    expect(tags[0].books.getItems()[0]).toBeInstanceOf(Book);
    expect(tags[0].books.getItems()[0]._id).toBeDefined();
    expect(tags[0].books.getItems()[0].isInitialized()).toBe(true);

    // test M:N lazy init
    orm.em.clear();
    let book = (await orm.em.findOne(Book, { tags: tag1._id }))!;
    expect(book.tags.isInitialized()).toBe(true); // owning side is always initialized
    expect(book.tags.count()).toBe(2);
    expect(book.tags.getItems()[0]).toBeInstanceOf(BookTag);
    expect(book.tags.getItems()[0]._id).toBeDefined();
    expect(book.tags.getItems()[0].isInitialized()).toBe(false);
    await book.tags.init();
    expect(book.tags.getItems()[0].isInitialized()).toBe(true);

    // test collection CRUD
    // remove
    expect(book.tags.count()).toBe(2);
    book.tags.remove(tag1, tag5); // tag5 will be ignored as it is not part of collection
    await orm.em.persist(book);
    orm.em.clear();
    book = (await orm.em.findOne(Book, book._id))!;
    expect(book.tags.count()).toBe(1);

    // add
    book.tags.add(tagRepository.getReference(tag1.id)); // we need to get reference as tag1 is detached from current EM
    await orm.em.persist(book);
    orm.em.clear();
    book = (await orm.em.findOne(Book, book._id))!;
    expect(book.tags.count()).toBe(2);

    // set
    const items = book.tags.getIdentifiers().map(t => tagRepository.getReference(t));
    book.tags.set(items);
    await orm.em.persist(book);
    orm.em.clear();
    book = (await orm.em.findOne(Book, book._id))!;
    expect(book.tags.count()).toBe(2);

    // contains
    expect(book.tags.contains(tag1)).toBe(true);
    expect(book.tags.contains(tag2)).toBe(false);
    expect(book.tags.contains(tag3)).toBe(true);
    expect(book.tags.contains(tag4)).toBe(false);
    expect(book.tags.contains(tag5)).toBe(false);

    // removeAll
    book.tags.removeAll();
    await orm.em.persist(book);
    orm.em.clear();
    book = (await orm.em.findOne(Book, book._id))!;
    expect(book.tags.count()).toBe(0);
  });

  test('populating many to many relation', async () => {
    const p1 = new Publisher('foo');
    expect(p1.tests).toBeInstanceOf(Collection);
    expect(p1.tests.isInitialized()).toBe(true);
    expect(p1.tests.isDirty()).toBe(false);
    expect(p1.tests.count()).toBe(0);
    const p2 = new Publisher('bar');
    p2.tests.add(new Test(), new Test());
    await orm.em.persist([p1, p2]);
    const repo = orm.em.getRepository(Publisher);

    orm.em.clear();
    const publishers = await repo.findAll(['tests']);
    expect(publishers).toBeInstanceOf(Array);
    expect(publishers.length).toBe(2);
    expect(publishers[0]).toBeInstanceOf(Publisher);
    expect(publishers[0].tests).toBeInstanceOf(Collection);
    expect(publishers[0].tests.isInitialized()).toBe(true);
    expect(publishers[0].tests.isDirty()).toBe(false);
    expect(publishers[0].tests.count()).toBe(0);
    await publishers[0].tests.init(); // empty many to many on owning side should not make db calls
    expect(publishers[1].tests.getItems()[0].isInitialized()).toBe(true);
  });

  test('populating many to many relation on inverse side', async () => {
    const author = new Author('Jon Snow', 'snow@wall.st');
    const book1 = new Book('My Life on The Wall, part 1', author);
    const book2 = new Book('My Life on The Wall, part 2', author);
    const book3 = new Book('My Life on The Wall, part 3', author);
    const tag1 = new BookTag('silly');
    const tag2 = new BookTag('funny');
    const tag3 = new BookTag('sick');
    const tag4 = new BookTag('strange');
    const tag5 = new BookTag('sexy');
    book1.tags.add(tag1, tag3);
    book2.tags.add(tag1, tag2, tag5);
    book3.tags.add(tag2, tag4, tag5);
    await orm.em.persist([book1, book2, book3]);
    const repo = orm.em.getRepository(BookTag);

    orm.em.clear();
    await repo.findOne(tag5.id, ['books']); // preload one of collections to test it is not re-loaded
    const tags = await repo.findAll(['books']);
    expect(tags).toBeInstanceOf(Array);
    expect(tags.length).toBe(5);
    expect(tags[0]).toBeInstanceOf(BookTag);
    expect(tags[0].books).toBeInstanceOf(Collection);
    expect(tags[0].books.isInitialized()).toBe(true);
    expect(tags[0].books.isDirty()).toBe(false);
    expect(tags[0].books.count()).toBe(2);
    expect(tags[0].books.getItems()[0].isInitialized()).toBe(true);
  });

  test('serializing empty initialized many to many collection', async () => {
    let a = new Author('name', 'email');
    await orm.em.persist(a);
    expect(a.toJSON()).toMatchObject({
      books: [],
    });
    orm.em.clear();

    a = (await orm.em.findOne(Author, a.id, ['books']))!;
    expect(a.toJSON()).toMatchObject({
      books: [],
    });
  });

  test('merging detached entity', async () => {
    const author = new Author('Jon Snow', 'snow@wall.st');
    const book1 = new Book('My Life on The Wall, part 1', author);
    const book2 = new Book('My Life on The Wall, part 2', author);
    const book3 = new Book('My Life on The Wall, part 3', author);
    author.favouriteBook = book1;
    const tag1 = new BookTag('silly');
    const tag2 = new BookTag('funny');
    const tag3 = new BookTag('sick');
    const tag4 = new BookTag('strange');
    const tag5 = new BookTag('sexy');
    book1.tags.add(tag1, tag3);
    book2.tags.add(tag1, tag2, tag5);
    book3.tags.add(tag2, tag4, tag5);
    await orm.em.persist([book1, book2, book3]);
    orm.em.clear();

    // cache author with favouriteBook and its tags
    const jon = await orm.em.findOne(Author, author.id, ['favouriteBook.tags']);
    const cache = jon!.toObject();

    // merge cached author with his references
    orm.em.clear();
    const cachedAuthor = orm.em.merge(Author, cache);
    expect(cachedAuthor).toBe(cachedAuthor.favouriteBook.author);
    expect(Object.keys(orm.em.getUnitOfWork().getIdentityMap())).toEqual([
      'BookTag-' + tag1.id,
      'BookTag-' + tag3.id,
      'Author-' + author.id,
      'Book-' + book1.id,
    ]);
    expect(author).not.toBe(cachedAuthor);
    expect(author.id).toBe(cachedAuthor.id);
    const book4 = new Book('My Life on The Wall, part 4', cachedAuthor);
    await orm.em.persist(book4);

    // merge detached author
    orm.em.clear();
    const cachedAuthor2 = orm.em.merge(author);
    expect(cachedAuthor2).toBe(cachedAuthor2.favouriteBook.author);
    expect(Object.keys(orm.em.getUnitOfWork().getIdentityMap())).toEqual([
      'Author-' + author.id,
      'Book-' + book1.id,
      'BookTag-' + tag1.id,
      'Book-' + book2.id,
      'BookTag-' + tag2.id,
      'Book-' + book3.id,
      'BookTag-' + tag4.id,
      'BookTag-' + tag5.id,
      'BookTag-' + tag3.id,
    ]);
    expect(author).toBe(cachedAuthor2);
    expect(author.id).toBe(cachedAuthor2.id);
    const book5 = new Book('My Life on The Wall, part 5', cachedAuthor2);
    await orm.em.persist(book5);
  });

  test('one to many collection sets inverse side reference after adding', async () => {
    const author = new Author('Jon Snow', 'snow@wall.st');
    const book1 = new Book('My Life on The Wall, part 1');
    const book2 = new Book('My Life on The Wall, part 2');
    const book3 = new Book('My Life on The Wall, part 3');
    author.books.add(book1, book2, book3);
    expect(book1.author).toBe(author);
    expect(book3.author).toBe(author);
    expect(book3.author).toBe(author);
  });

  test('many to many collection sets inverse side reference after adding', async () => {
    const book1 = new Book('My Life on The Wall, part 1');
    const book2 = new Book('My Life on The Wall, part 2');
    const book3 = new Book('My Life on The Wall, part 3');
    const tag1 = new BookTag('silly');
    const tag2 = new BookTag('funny');
    const tag3 = new BookTag('sick');
    book1.tags.add(tag1, tag3);
    book2.tags.add(tag1, tag2);
    book3.tags.add(tag2);
    expect(tag1.books[0]).toBe(book1);
    expect(tag1.books[1]).toBe(book2);
    expect(tag1.books.length).toBe(2);
    expect(tag2.books[0]).toBe(book2);
    expect(tag2.books[1]).toBe(book3);
    expect(tag2.books.length).toBe(2);
    expect(tag3.books[0]).toBe(book1);
    expect(tag3.books.length).toBe(1);
  });

  test('many to many collection sets owning side reference after adding', async () => {
    const book1 = new Book('My Life on The Wall, part 1');
    const book2 = new Book('My Life on The Wall, part 2');
    const book3 = new Book('My Life on The Wall, part 3');
    const tag1 = new BookTag('silly');
    const tag2 = new BookTag('funny');
    const tag3 = new BookTag('sick');
    tag1.books.add(book1, book2);
    tag2.books.add(book2, book3);
    tag3.books.add(book1);
    expect(tag1.books[0]).toBe(book1);
    expect(tag1.books[1]).toBe(book2);
    expect(tag1.books.length).toBe(2);
    expect(tag2.books[0]).toBe(book2);
    expect(tag2.books[1]).toBe(book3);
    expect(tag2.books.length).toBe(2);
    expect(tag3.books[0]).toBe(book1);
    expect(tag3.books.length).toBe(1);
  });

  test('cascade persist on owning side', async () => {
    const author = new Author('Jon Snow', 'snow@wall.st');
    const book1 = new Book('My Life on The Wall, part 1');
    const book2 = new Book('My Life on The Wall, part 2');
    const book3 = new Book('My Life on The Wall, part 3');
    author.books.add(book1, book2, book3);
    const tag1 = new BookTag('silly');
    const tag2 = new BookTag('funny');
    const tag3 = new BookTag('sick');
    const tag4 = new BookTag('strange');
    const tag5 = new BookTag('sexy');
    book1.tags.add(tag1, tag3);
    book2.tags.add(tag1, tag2, tag5);
    book3.tags.add(tag2, tag4, tag5);
    await orm.em.persist(author);
    orm.em.clear();

    const repo = orm.em.getRepository(Book);
    let book = (await repo.findOne(book1.id, ['author', 'tags']))!;
    book.author.name = 'Foo Bar';
    book.tags[0].name = 'new name 1';
    book.tags[1].name = 'new name 2';
    await orm.em.persist(book);
    orm.em.clear();

    book = (await repo.findOne(book1.id, ['author', 'tags']))!;
    expect(book.author.name).toBe('Foo Bar');
    expect(book.tags[0].name).toBe('new name 1');
    expect(book.tags[1].name).toBe('new name 2');
  });

  test('cascade persist on inverse side', async () => {
    const author = new Author('Jon Snow', 'snow@wall.st');
    const book1 = new Book('My Life on The Wall, part 1', author);
    const book2 = new Book('My Life on The Wall, part 2', author);
    const book3 = new Book('My Life on The Wall, part 3', author);
    const tag1 = new BookTag('silly');
    const tag2 = new BookTag('funny');
    const tag3 = new BookTag('sick');
    const tag4 = new BookTag('strange');
    const tag5 = new BookTag('sexy');
    book1.tags.add(tag1, tag3);
    book2.tags.add(tag1, tag2, tag5);
    book3.tags.add(tag2, tag4, tag5);
    await orm.em.persist([book1, book2, book3]);
    orm.em.clear();

    const repo = orm.em.getRepository(BookTag);
    let tag = (await repo.findOne(tag5.id, ['books.author']))!;
    tag.books[0].title = 'new title 1';
    tag.books[1].title = 'new title 2';
    tag.books[1].author.name = 'Foo Bar';
    await orm.em.persist(tag);
    orm.em.clear();

    tag = (await repo.findOne(tag5.id, ['books.author']))!;
    expect(tag.books[0].title).toBe('new title 1');
    expect(tag.books[1].title).toBe('new title 2');
    expect(tag.books[1].author.name).toBe('Foo Bar');
  });

  test('cascade remove on 1:m collection', async () => {
    const author = new Author('Jon Snow', 'snow@wall.st');
    const book1 = new Book('My Life on The Wall, part 1', author);
    const book2 = new Book('My Life on The Wall, part 2', author);
    const book3 = new Book('My Life on The Wall, part 3', author);
    author.books.add(book1, book2, book3);
    const tag1 = new BookTag('silly');
    const tag2 = new BookTag('funny');
    const tag3 = new BookTag('sick');
    const tag4 = new BookTag('strange');
    const tag5 = new BookTag('sexy');
    book1.tags.add(tag1, tag3);
    book2.tags.add(tag1, tag2, tag5);
    book3.tags.add(tag2, tag4, tag5);
    await orm.em.persist(author);
    orm.em.clear();

    const repo = orm.em.getRepository(Book);
    let books = await repo.findAll(['author', 'tags']);
    expect(books.length).toBe(3);
    expect(books[0].tags.count()).toBe(2);
    await books[0].author.books.init();
    await orm.em.removeEntity(books[0].author);
    orm.em.clear();

    books = await repo.findAll();
    expect(books.length).toBe(0);
  });

  test('cascade remove on m:1 reference', async () => {
    const author = new Author('Jon Snow', 'snow@wall.st');
    const book1 = new Book('My Life on The Wall, part 1', author);
    const book2 = new Book('My Life on The Wall, part 2', author);
    const book3 = new Book('My Life on The Wall, part 3', author);
    book1.publisher = book2.publisher = book3.publisher = new Publisher('to be removed');
    author.books.add(book1, book2, book3);
    await orm.em.persist(author);
    orm.em.clear();

    const repo = orm.em.getRepository(Book);
    let books = await repo.findAll();
    expect(books.length).toBe(3);
    expect(books[0].publisher.id).toBeDefined();
    expect(await orm.em.count(Publisher, {})).toBe(1);

    // we need to remove those books from IM or ORM will try to persist them automatically (and they still have link to the publisher)
    orm.em.getUnitOfWork().unsetIdentity(books[1]);
    orm.em.getUnitOfWork().unsetIdentity(books[2]);

    // by removing one book, publisher will be cascade removed and other books will remain its identifier
    await orm.em.removeEntity(books[0]);
    orm.em.clear();

    books = await repo.findAll();
    expect(books.length).toBe(2);
    expect(books[0].publisher).not.toBeNull();
    expect(books[1].publisher).not.toBeNull();
    expect(await orm.em.count(Publisher, {})).toBe(0);
  });

  test('nested populating', async () => {
    const author = new Author('Jon Snow', 'snow@wall.st');
    const book1 = new Book('My Life on The Wall, part 1', author);
    const book2 = new Book('My Life on The Wall, part 2', author);
    const book3 = new Book('My Life on The Wall, part 3', author);
    book1.publisher = new Publisher('B1 publisher');
    book1.publisher.tests.add(Test.create('t11'), Test.create('t12'));
    book2.publisher = new Publisher('B2 publisher');
    book2.publisher.tests.add(Test.create('t21'), Test.create('t22'));
    book3.publisher = new Publisher('B3 publisher');
    book3.publisher.tests.add(Test.create('t31'), Test.create('t32'));
    const tag1 = new BookTag('silly');
    const tag2 = new BookTag('funny');
    const tag3 = new BookTag('sick');
    const tag4 = new BookTag('strange');
    const tag5 = new BookTag('sexy');
    book1.tags.add(tag1, tag3);
    book2.tags.add(tag1, tag2, tag5);
    book3.tags.add(tag2, tag4, tag5);
    await orm.em.persist([book1, book2, book3]);
    const repo = orm.em.getRepository(BookTag);

    orm.em.clear();
    const tags = await repo.findAll(['books.publisher.tests', 'books.author']);
    expect(tags.length).toBe(5);
    expect(tags[0]).toBeInstanceOf(BookTag);
    expect(tags[0].books.isInitialized()).toBe(true);
    expect(tags[0].books.count()).toBe(2);
    expect(tags[0].books[0].isInitialized()).toBe(true);
    expect(tags[0].books[0].author).toBeInstanceOf(Author);
    expect(tags[0].books[0].author.isInitialized()).toBe(true);
    expect(tags[0].books[0].author.name).toBe('Jon Snow');
    expect(tags[0].books[0].publisher).toBeInstanceOf(Publisher);
    expect(tags[0].books[0].publisher.isInitialized()).toBe(true);
    expect(tags[0].books[0].publisher.tests.isInitialized(true)).toBe(true);
    expect(tags[0].books[0].publisher.tests.count()).toBe(2);
    expect(tags[0].books[0].publisher.tests[0].name).toBe('t11');
    expect(tags[0].books[0].publisher.tests[1].name).toBe('t12');

    orm.em.clear();
    const books = await orm.em.find(Book, {}, ['publisher.tests', 'author']);
    expect(books.length).toBe(3);
    expect(books[0]).toBeInstanceOf(Book);
    expect(books[0].isInitialized()).toBe(true);
    expect(books[0].author).toBeInstanceOf(Author);
    expect(books[0].author.isInitialized()).toBe(true);
    expect(books[0].author.name).toBe('Jon Snow');
    expect(books[0].publisher).toBeInstanceOf(Publisher);
    expect(books[0].publisher.isInitialized()).toBe(true);
    expect(books[0].publisher.tests.isInitialized(true)).toBe(true);
    expect(books[0].publisher.tests.count()).toBe(2);
    expect(books[0].publisher.tests[0].name).toBe('t11');
    expect(books[0].publisher.tests[1].name).toBe('t12');
  });

  test('nested populating with empty collection', async () => {
    const author = new Author('Jon Snow', 'snow@wall.st');
    const book1 = new Book('My Life on The Wall, part 1', author);
    const book2 = new Book('My Life on The Wall, part 2', author);
    const book3 = new Book('My Life on The Wall, part 3', author);
    const tag1 = new BookTag('silly');
    const tag2 = new BookTag('funny');
    const tag3 = new BookTag('sick');
    const tag4 = new BookTag('strange');
    const tag5 = new BookTag('sexy');
    book1.tags.add(tag1, tag3);
    book2.tags.add(tag1, tag2, tag5);
    book3.tags.add(tag2, tag4, tag5);
    await orm.em.persist([book1, book2, book3]);
    const repo = orm.em.getRepository(BookTag);

    orm.em.clear();
    const tags = await repo.findAll(['books.publisher.tests']);
    expect(tags.length).toBe(5);
    expect(tags[0]).toBeInstanceOf(BookTag);
    expect(tags[0].books.isInitialized()).toBe(true);
    expect(tags[0].books.count()).toBe(2);
    expect(tags[0].books[0].isInitialized()).toBe(true);
    expect(tags[0].books[0].publisher).toBeUndefined();
  });

  test('populating one to many relation', async () => {
    let author = new Author('Jon Snow', 'snow@wall.st');
    const book1 = new Book('My Life on The Wall, part 1', author);
    const book2 = new Book('My Life on The Wall, part 2', author);
    const book3 = new Book('My Life on The Wall, part 3', author);
    await orm.em.persist([book1, book2, book3]);
    const repo = orm.em.getRepository(Author);

    orm.em.clear();
    author = (await repo.findOne(author.id))!;
    expect(author.books).toBeInstanceOf(Collection);
    expect(author.books.isInitialized(true)).toBe(false);
    await author.books.init();
    expect(author.books.isInitialized(true)).toBe(true);
    expect(author.books.count()).toBe(3);
  });

  test('hooks', async () => {
    Author.beforeDestroyCalled = 0;
    Author.afterDestroyCalled = 0;
    const repo = orm.em.getRepository(Author);
    const author = new Author('Jon Snow', 'snow@wall.st');
    expect(author.id).toBeNull();
    expect(author.version).toBeUndefined();
    expect(author.versionAsString).toBeUndefined();

    await repo.persist(author);
    expect(author.id).not.toBeNull();
    expect(author.version).toBe(1);
    expect(author.versionAsString).toBe('v1');

    author.name = 'John Snow';
    await repo.flush();
    expect(author.version).toBe(2);
    expect(author.versionAsString).toBe('v2');

    expect(Author.beforeDestroyCalled).toBe(0);
    expect(Author.afterDestroyCalled).toBe(0);
    await repo.remove(author);
    expect(Author.beforeDestroyCalled).toBe(1);
    expect(Author.afterDestroyCalled).toBe(1);

    const author2 = new Author('Johny Cash', 'johny@cash.com');
    await repo.persist(author2);
    await repo.remove(author2);
    expect(Author.beforeDestroyCalled).toBe(2);
    expect(Author.afterDestroyCalled).toBe(2);
  });

  test('canPopulate', async () => {
    const repo = orm.em.getRepository(Author);
    expect(repo.canPopulate('test')).toBe(false);
    expect(repo.canPopulate('name')).toBe(false);
    expect(repo.canPopulate('favouriteBook')).toBe(true);
    expect(repo.canPopulate('books')).toBe(true);
  });

  test('trying to populate non-existing or non-reference property will throw', async () => {
    const repo = orm.em.getRepository(Author);
    const author = new Author('Johny Cash', 'johny@cash.com');
    await repo.persist(author);
    orm.em.clear();

    await expect(repo.findAll(['tests'])).rejects.toThrowError(`Entity 'Author' does not have property 'tests'`);
    await expect(repo.findOne(author.id, ['tests'])).rejects.toThrowError(`Entity 'Author' does not have property 'tests'`);
  });

  test('many to many collection does have fixed order', async () => {
    const repo = orm.em.getRepository(Publisher);
    const publisher = new Publisher();
    const t1 = Test.create('t1');
    const t2 = Test.create('t2');
    const t3 = Test.create('t3');
    await orm.em.persist([t1, t2, t3]);
    publisher.tests.add(t2, t1, t3);
    await repo.persist(publisher);
    orm.em.clear();

    const ent = (await repo.findOne(publisher.id))!;
    await expect(ent.tests.count()).toBe(3);
    await expect(ent.tests.getIdentifiers('id')).toEqual([t2.id, t1.id, t3.id]);

    await ent.tests.init();
    await expect(ent.tests.getIdentifiers('id')).toEqual([t2.id, t1.id, t3.id]);
  });

  test('property onUpdate hook (updatedAt field)', async () => {
    const repo = orm.em.getRepository(Author);
    const author = new Author('name', 'email');
    await expect(author.createdAt).toBeDefined();
    await expect(author.updatedAt).toBeDefined();
    // allow 1 ms difference as updated time is recalculated when persisting
    await expect(+author.updatedAt - +author.createdAt).toBeLessThanOrEqual(1);
    await repo.persist(author);

    author.name = 'name1';
    await repo.flush();
    await expect(author.createdAt).toBeDefined();
    await expect(author.updatedAt).toBeDefined();
    await expect(author.updatedAt).not.toEqual(author.createdAt);
    await expect(author.updatedAt > author.createdAt).toBe(true);

    orm.em.clear();
    const ent = (await repo.findOne(author.id))!;
    await expect(ent.createdAt).toBeDefined();
    await expect(ent.updatedAt).toBeDefined();
    await expect(ent.updatedAt).not.toEqual(ent.createdAt);
    await expect(ent.updatedAt > ent.createdAt).toBe(true);
  });

  test('EM supports native insert/update/delete/aggregate', async () => {
    const mock = jest.fn();
    const logger = new Logger(mock, true);
    Object.assign(orm.em.getConnection(), { logger });

    const res1 = await orm.em.nativeInsert(Author, { name: 'native name 1' });
    expect(res1).toBeInstanceOf(ObjectID);

    const res2 = await orm.em.nativeUpdate(Author, { name: 'native name 1' }, { name: 'new native name' });
    expect(res2).toBe(1);

    const res3 = await orm.em.aggregate(Author, [{ $match: { name: 'new native name' } }]);
    expect(res3.length).toBe(1);
    expect(res3[0]).toMatchObject({ name: 'new native name' });

    const res4 = await orm.em.nativeDelete(Author, { name: 'new native name' });
    expect(res4).toBe(1);

    const res5 = await orm.em.nativeInsert(Author, { createdAt: new Date('1989-11-17'), updatedAt: new Date('2018-10-28'), name: 'native name 2' });
    expect(res5).toBeInstanceOf(ObjectID);

    const res6 = await orm.em.nativeUpdate(Author, { name: 'native name 2' }, { name: 'new native name', updatedAt: new Date('2018-10-28') });
    expect(res6).toBe(1);

    const res7 = await orm.em.nativeInsert('test', { name: 'native name 1', test: 'abc' });
    expect(res7).toBeInstanceOf(ObjectID);

    const res8 = await orm.em.nativeUpdate('test', { name: 'native name 1' }, { $unset: { test: 1 } });
    expect(res8).toBe(1);

    const res9 = await orm.em.nativeDelete('test', { name: 'native name 1' });
    expect(res9).toBe(1);

    expect(mock.mock.calls.length).toBe(9);
    expect(mock.mock.calls[0][0]).toMatch(/db\.getCollection\("author"\)\.insertOne\({"name":"native name 1","_id":".*"}\);/);
    expect(mock.mock.calls[1][0]).toMatch(/db\.getCollection\("author"\)\.updateMany\({"name":"native name 1"}, {"\$set":{"name":"new native name"}}\);/);
    expect(mock.mock.calls[2][0]).toMatch(/db\.getCollection\("author"\)\.aggregate\(\[{"\$match":{"name":"new native name"}}]\)\.toArray\(\);/);
    expect(mock.mock.calls[3][0]).toMatch(/db\.getCollection\("author"\)\.deleteMany\({"name":"new native name"}\)/);
    expect(mock.mock.calls[4][0]).toMatch(/db\.getCollection\("author"\)\.insertOne\({"createdAt":".*","updatedAt":".*","name":"native name 2","_id":".*"}\);/);
    expect(mock.mock.calls[5][0]).toMatch(/db\.getCollection\("author"\)\.updateMany\({"name":"native name 2"}, {"\$set":{"name":"new native name","updatedAt":".*"}}\);/);
    expect(mock.mock.calls[6][0]).toMatch(/db\.getCollection\("test"\)\.insertOne\({"name":"native name 1","test":"abc","_id":".*"}\);/);
    expect(mock.mock.calls[7][0]).toMatch(/db\.getCollection\("test"\)\.updateMany\({"name":"native name 1"}, {"\$unset":{"test":1}}\);/);
    expect(mock.mock.calls[8][0]).toMatch(/db\.getCollection\("test"\)\.deleteMany\({"name":"native name 1"}\)/);
  });

  test('1:m collection is initialized when entity loaded from EM', async () => {
    const author = new Author('name', 'email');
    const b1 = new Book('b1', author);
    const b2 = new Book('b2', author);
    const b3 = new Book('b3', author);
    orm.em.persistLater([b1, b2, b3]);
    await orm.em.flush();
    orm.em.clear();

    const a1 = (await orm.em.findOne(Author, author.id))!;
    expect(a1.books).toBeInstanceOf(Collection);
    expect(a1.books.isInitialized()).toBe(false);

    await orm.em.nativeUpdate(Author, { id: author.id }, { books: [b1.id, b2.id, b3.id] });
    orm.em.clear();

    const a2 = (await orm.em.findOne(Author, author.id))!;
    expect(a2.books).toBeInstanceOf(Collection);
    expect(a2.books.isInitialized()).toBe(true);
    expect(a2.books.isInitialized(true)).toBe(false);
  });

  test('EM supports smart search conditions', async () => {
    const author = new Author('name', 'email');
    author.born = new Date('1990-03-23');
    const b1 = new Book('b1', author);
    const b2 = new Book('b2', author);
    const b3 = new Book('b3', author);
    await orm.em.persist([b1, b2, b3]);
    orm.em.clear();

    const a1 = (await orm.em.findOne(Author, { 'id:ne': '5ec6d9bf90dae100fbed92ba' }))!;
    expect(a1).not.toBeNull();
    expect(a1.id).toBe(author.id);
    const a2 = (await orm.em.findOne(Author, { 'id>=': author.id }))!;
    expect(a2).not.toBeNull();
    expect(a2.id).toBe(author.id);
    const a3 = (await orm.em.findOne(Author, { 'id:nin': ['5ec6d9bf90dae100fbed92ba'] }))!;
    expect(a3).not.toBeNull();
    expect(a3.id).toBe(author.id);
    const now = new Date();
    const a4 = (await orm.em.findOne(Author, { $or: [
      { 'date >': now },
      { 'date <': now },
      { 'date >=': now },
      { 'date <=': now },
      { 'date !=': now },
    ] }))!;
    expect(a4).not.toBeNull();
    expect(a4.id).toBe(author.id);
  });

  test('self referencing (2 step)', async () => {
    const author = new Author('name', 'email');
    const b1 = new Book('b1', author);
    const b2 = new Book('b2', author);
    const b3 = new Book('b3', author);
    await orm.em.persist([b1, b2, b3]);
    author.favouriteAuthor = author;
    await orm.em.flush();
    orm.em.clear();

    const a1 = (await orm.em.findOne(Author, { id: author.id }))!;
    expect(a1).toBe(a1.favouriteAuthor);
    expect(a1.id).not.toBeNull();
    expect(a1.toJSON()).toMatchObject({ favouriteAuthor: a1.id });
  });

  test('self referencing (1 step)', async () => {
    const mock = jest.fn();
    const logger = new Logger(mock, true);
    Object.assign(orm.em.getConnection(), { logger });

    const author = new Author('name', 'email');
    author.favouriteAuthor = author;
    const b1 = new Book('b1', author);
    const b2 = new Book('b2', author);
    const b3 = new Book('b3', author);
    await orm.em.persist([b1, b2, b3]);
    orm.em.clear();

    const a1 = (await orm.em.findOne(Author, { id: author.id }))!;
    expect(a1).toBe(a1.favouriteAuthor);
    expect(a1.id).not.toBeNull();
    expect(a1.toJSON()).toMatchObject({ favouriteAuthor: a1.id });

    // check fired queries
    expect(mock.mock.calls.length).toBe(6);
    expect(mock.mock.calls[0][0]).toMatch(/db\.getCollection\("author"\)\.insertOne\({"createdAt":".*","updatedAt":".*","termsAccepted":.*,"name":".*","email":".*","foo":".*","_id":".*"}\);/);
    expect(mock.mock.calls[1][0]).toMatch(/db\.getCollection\("books-table"\)\.insertOne\({"title":"b1","author":".*","_id":".*"}\);/);
    expect(mock.mock.calls[2][0]).toMatch(/db\.getCollection\("books-table"\)\.insertOne\({"title":"b2","author":".*","_id":".*"}\);/);
    expect(mock.mock.calls[3][0]).toMatch(/db\.getCollection\("books-table"\)\.insertOne\({"title":"b3","author":".*","_id":".*"}\);/);
    expect(mock.mock.calls[4][0]).toMatch(/db\.getCollection\("author"\)\.updateMany\({"_id":".*"}, {"\$set":{"favouriteAuthor":".*","updatedAt":".*"}}\);/);
    expect(mock.mock.calls[5][0]).toMatch(/db\.getCollection\("author"\)\.find\(.*\)\.toArray\(\);/);
  });

  test('self referencing via another entity M:1 (1 step)', async () => {
    const author = new Author('Jon Snow', 'snow@wall.st');
    const book1 = new Book('My Life on The Wall, part 1', author);
    author.favouriteBook = book1; // author -> book1 -> author
    await orm.em.persist(book1);
    orm.em.clear();

    const jon = await orm.em.findOne(Author, author.id, ['favouriteBook']);
    expect(jon!.favouriteBook).toBeInstanceOf(Book);
    expect(jon!.favouriteBook.title).toBe(book1.title);
  });

  test('self referencing M:N (1 step)', async () => {
    const a1 = new Author('A1', 'a1@wall.st');
    const a2 = new Author('A2', 'a2@wall.st');
    const a3 = new Author('A3', 'a3@wall.st');
    const author = new Author('Jon Snow', 'snow@wall.st');
    author.friends.add(a1, a2, a3, author);
    await orm.em.persist(author);
    orm.em.clear();

    const jon = await orm.em.findOne(Author, author.id, ['friends']);
    const authors = await orm.em.find(Author, {}, { orderBy: { name: QueryOrder.ASC } });
    expect(jon!.friends.isInitialized(true)).toBe(true);
    expect(jon!.friends.toArray()).toMatchObject(authors.map(a => a.toJSON(true, ['id', 'email', 'friends'])));
  });

  test('orphan removal 1:M', async () => {
    const author = new Author('Jon Snow', 'snow@wall.st');
    const b1 = new Book('b1', author);
    const b2 = new Book('b2', author);
    const b3 = new Book('b3', author);
    author.books.add(b1, b2, b3);
    await orm.em.persist(author);

    // removing book from collection will trigger orphan removal
    author.books.remove(b1);
    await orm.em.flush();
    await expect(orm.em.findOne(Book, b1)).resolves.toBeNull();
    await expect(orm.em.findOne(Book, b3)).resolves.not.toBeNull();

    // replacing collection items will trigger orphan removal
    author.books.remove(b2);
    author.books.set([b1, b2]);
    await orm.em.flush();
    await expect(orm.em.findOne(Book, b1)).resolves.not.toBeNull();
    await expect(orm.em.findOne(Book, b3)).resolves.toBeNull();

    // removing author will cascade the operation as orphan removal behaves also like cascade remove
    await orm.em.removeEntity(author);
    await expect(orm.em.count(Book, { author })).resolves.toBe(0);
  });

  test('orphan removal 1:1', async () => {
    const bar = FooBar.create('fb');
    const baz1 = FooBaz.create('fz1');
    const baz2 = FooBaz.create('fz2');
    bar.baz = baz1;
    await orm.em.persist(bar);
    expect(orm.em.getUnitOfWork()['originalEntityData'][bar.__uuid].baz).toEqual(baz1._id);

    // replacing reference with value will trigger orphan removal
    bar.baz = baz2;
    await orm.em.persist(bar);
    expect(orm.em.getUnitOfWork()['originalEntityData'][bar.__uuid].baz).toEqual(baz2._id);
    await expect(orm.em.findOne(FooBaz, baz1)).resolves.toBeNull();
    await expect(orm.em.findOne(FooBaz, baz2)).resolves.not.toBeNull();

    // replacing reference with null will trigger orphan removal
    bar.baz = null;
    await orm.em.persist(bar);
    await expect(orm.em.findOne(FooBaz, baz2)).resolves.toBeNull();

    // removing bar will cascade the operation as orphan removal behaves also like cascade remove
    bar.baz = baz1;
    await orm.em.persist(bar);
    await orm.em.removeEntity(bar);
    await expect(orm.em.count(FooBaz, { bar })).resolves.toBe(0);
  });

  test('EM do not support transactions', async () => {
    await expect(orm.em.beginTransaction()).rejects.toThrowError('Transactions are not supported by current driver');
    await expect(orm.em.rollback()).rejects.toThrowError('Transactions are not supported by current driver');
    await expect(orm.em.commit()).rejects.toThrowError('Transactions are not supported by current driver');
  });

  test('loading connected entity will not update identity map for associations', async () => {
    const author = new Author('Jon Snow', 'snow@wall.st');
    author.favouriteBook = new Book('b1', author);
    await orm.em.persist(author);
    orm.em.clear();

    const a = (await orm.em.findOne(Author, author, ['favouriteBook']))!;
    expect(a).not.toBe(author);
    a.name = 'test 1';
    a.favouriteBook.title = 'test 2';
    const a1 = (await orm.em.findOne(Author, { favouriteBook: a.favouriteBook }))!;
    const b1 = (await orm.em.findOne(Book, { author }))!;
    expect(a.name).toBe('test 1');
    expect(a.favouriteBook.title).toBe('test 2');
    expect(a1.name).toBe('test 1');
    expect(b1.title).toBe('test 2');
    await orm.em.persist(a);
    orm.em.clear();

    const a2 = (await orm.em.findOne(Author, author))!;
    const b2 = (await orm.em.findOne(Book, { author }))!;
    expect(a2.name).toBe('test 1');
    expect(b2.title).toBe('test 2');
  });

  test('getReference will not update identity map copy', async () => {
    const author = new Author('Jon Snow', 'snow@wall.st');
    author.favouriteBook = new Book('b1', author);
    await orm.em.persist(author);
    orm.em.clear();

    const a = (await orm.em.findOne(Author, author, ['favouriteBook']))!;
    expect(a).not.toBe(author);
    a.name = 'test 1';
    a.favouriteBook.title = 'test 2';
    const a1 = orm.em.getReference(Author, a.id)!;
    const b1 = orm.em.getReference(Book, a.favouriteBook.id)!;
    expect(a.name).toBe('test 1');
    expect(a.favouriteBook.title).toBe('test 2');
    expect(a1.name).toBe('test 1');
    expect(b1.title).toBe('test 2');
    await orm.em.persist(a);
    orm.em.clear();

    const a2 = (await orm.em.findOne(Author, author))!;
    const b2 = (await orm.em.findOne(Book, { author }))!;
    expect(a2.name).toBe('test 1');
    expect(b2.title).toBe('test 2');
  });

  test('partial selects', async () => {
    const author = new Author('Jon Snow', 'snow@wall.st');
    author.born = new Date();
    await orm.em.persist(author);
    orm.em.clear();

    const a = (await orm.em.findOne(Author, author, { fields: ['name'] }))!;
    expect(a.name).toBe('Jon Snow');
    expect(a.email).toBeUndefined();
    expect(a.born).toBeUndefined();
  });

  test('automatically fix PK instead of entity when flushing (m:1)', async () => {
    const author = new Author('Jon Snow', 'snow@wall.st');
    Object.assign(author, { favouriteBook: '0000007b5c9c61c332380f78' });
    expect(author.favouriteBook).not.toBeInstanceOf(Book);
    expect(author.favouriteBook).toBe('0000007b5c9c61c332380f78');
    await orm.em.persist(author);
    expect(author.favouriteBook).toBeInstanceOf(Book);
    expect(author.favouriteBook.id).toBe('0000007b5c9c61c332380f78');
  });

  test('automatically fix array of PKs instead of collection when flushing (m:n)', async () => {
    const mock = jest.fn();
    const logger = new Logger(mock, true);
    Object.assign(orm.em.getConnection(), { logger });

    const author = new Author('Jon Snow', 'snow@wall.st');
    const book = new Book('B123', author);
    await orm.em.persistAndFlush(book);

    const tag = orm.em.getReference(BookTag, '0000007b5c9c61c332380f79');
    Object.assign(book, { tags: ['0000007b5c9c61c332380f78', tag] });
    expect(book.tags).not.toBeInstanceOf(Collection);
    expect(book.tags).toEqual(['0000007b5c9c61c332380f78', tag]);
    await orm.em.persistLater(book);
    expect(book.tags).toBeInstanceOf(Collection);
    expect(book.tags[0]).toBeInstanceOf(BookTag);
    expect(book.tags[1]).toBeInstanceOf(BookTag);
    expect(book.tags[0].id).toBe('0000007b5c9c61c332380f78');
    expect(book.tags[1].id).toBe('0000007b5c9c61c332380f79');
    expect(book.tags.isInitialized()).toBe(true);
    expect(book.tags.isDirty()).toBe(true);

    await orm.em.flush();
    expect(mock.mock.calls[0][0]).toMatch(/db\.getCollection\("author"\)\.insertOne\({"createdAt":".*","updatedAt":".*","termsAccepted":false,"name":"Jon Snow","email":"snow@wall\.st","foo":"bar","_id":".*"}\);/);
    expect(mock.mock.calls[1][0]).toMatch(/db\.getCollection\("books-table"\)\.insertOne\({"title":"B123","author":".*","_id":".*"}\);/);
    expect(mock.mock.calls[2][0]).toMatch(/db\.getCollection\("books-table"\)\.updateMany\({"_id":".*"}, {"\$set":{"tags":\["0000007b5c9c61c332380f78","0000007b5c9c61c332380f79"]}}\);/);
  });

  test('automatically fix PK in collection instead of entity when flushing (m:n)', async () => {
    const author = new Author('Jon Snow', 'snow@wall.st');
    const book = new Book('B123', author);
    book.tags.set(['0000007b5c9c61c332380f78' as any]);
    expect(book.tags).not.toBeInstanceOf(BookTag);
    expect(book.tags[0]).toBeInstanceOf(BookTag);
    expect(book.tags[0].id).toBe('0000007b5c9c61c332380f78');
    expect(book.tags.isInitialized()).toBe(true);
    expect(book.tags.isDirty()).toBe(true);
  });

  test('automatically map raw results to entities when setting collection items', async () => {
    const god = new Author('God', 'hello@heaven.god');
    const bookData = { title: 'Bible', author: god.id };
    god.books.add(bookData as any);
    expect(god.books[0]).toBeInstanceOf(Book);
  });

  afterAll(async () => orm.close(true));

});
