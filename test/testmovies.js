let envPath = __dirname + "/../.env"
require('dotenv').config({path:envPath});
let chai = require('chai');
let chaiHttp = require('chai-http');
let server = require('../server');
let User = require('../Users');
let Movie = require('../Movies');
chai.should();

chai.use(chaiHttp);

let login_details = {
    name: 'test2',
    username: 'email2@email.com',
    password: '123@abc'
}

let movie_details = {
    title: 'Alice in Wonderland',
    releaseDate: 2010,
    genre: 'Fantasy',
    actors: [ { actorName: 'Mia Wasikowska', characterName: 'Alice Kingsleigh' }, { actorName: 'Johnny Depp', characterName: 'Mad Hatter' }, { actorName: 'Helena Bonham Carter', characterName: 'Red Queen' } ]
}

let token = ''

describe('Test Movie Routes', () => {
   before(async () => { // Before test initialize the database to empty
        await User.deleteOne({ name: 'test2' });
        await Movie.deleteOne({ title: 'Alice in Wonderland' });
    })

    after(async () => { // after this test suite empty the database
        await User.deleteOne({ name: 'test2' });
        await Movie.deleteOne({ title: 'Alice in Wonderland' });
    })

    describe('/signup', () => {
        it('it should register, login and check our token', (done) => {
          chai.request(server)
              .post('/signup')
              .send(login_details)
              .end((err, res) =>{
                                res.should.have.status(201);
                res.body.success.should.be.eql(true);
                //follow-up to get the JWT token
                chai.request(server)
                    .post('/signin')
                    .send(login_details)
                    .end((err, res) => {
                        res.should.have.status(200);
                        res.body.should.have.property('token');
                        token = res.body.token;
                        done();
                    })
              })
        })
    });

    //Test the POST route
    describe('POST Movies', () => {
        it('it return all movies', (done) => {
            chai.request(server)
                .post('/movies')
                .set('Authorization', token)
                .send(movie_details)
                .end((err, res) => {
                    res.should.have.status(201);
                    done();
                })
        })
    });

    //Test the GET route
    describe('GET Movies', () => {
        it('it return all movies', (done) => {
            chai.request(server)
                .get('/movies')
                .set('Authorization', token)
                .send()
                .end((err, res) => {
                    res.should.have.status(200);
                    res.body.should.have.property('movies');
                    res.body.movies.should.be.an('array');
                    res.body.movies.forEach(movie => {
                        movie.should.have.property('title')
                        movie.should.have.property('releaseDate')
                        movie.should.have.property('genre')
                        movie.should.have.property('actors')
                    });
                    done();
                })
        })
    });
});