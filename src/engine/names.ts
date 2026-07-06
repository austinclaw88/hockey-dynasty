// Nationality-weighted name pools for generated draft prospects and filler
// players. ~80 first + ~80 last names per major hockey nation. Deterministic
// selection is done by the caller via the seeded RNG.

import type { Rng } from './rng.ts'

interface NamePool {
  first: string[]
  last: string[]
}

const CAN: NamePool = {
  first: [
    'Connor', 'Nathan', 'Ryan', 'Brayden', 'Dylan', 'Logan', 'Owen', 'Mason', 'Ethan', 'Liam',
    'Nolan', 'Cole', 'Tyson', 'Carter', 'Hunter', 'Jaxon', 'Landon', 'Wyatt', 'Rylan', 'Braden',
    'Colton', 'Kaden', 'Riley', 'Brady', 'Jack', 'Nash', 'Cooper', 'Bennett', 'Easton', 'Grayson',
    'Reid', 'Tanner', 'Trevor', 'Josh', 'Jordan', 'Cameron', 'Zach', 'Brandon', 'Devon', 'Keegan',
    'Shane', 'Curtis', 'Travis', 'Blake', 'Marc', 'Pierre', 'Alexis', 'Samuel', 'Gabriel', 'William',
    'Felix', 'Olivier', 'Xavier', 'Antoine', 'Zachary', 'Nicolas', 'Maxime', 'Charles', 'Vincent', 'Emile',
    'Hudson', 'Beckett', 'Callum', 'Declan', 'Rowan', 'Finn', 'Griffin', 'Hayden', 'Isaac', 'Jesse',
    'Kellan', 'Lucas', 'Miles', 'Preston', 'Quinn', 'Spencer', 'Tristan', 'Weston', 'Zane', 'Dawson',
  ],
  last: [
    'MacKinnon', 'Crosby', 'Stamkos', 'Toews', 'Benn', 'Couture', 'Reinhart', 'Point', 'Marner', 'Nugent',
    'Scheifele', 'Barzal', 'Stone', 'Duchene', 'Sanheim', 'Hamonic', 'McLeod', 'Foegele', 'Dermott', 'Comtois',
    'Lafreniere', 'Dubois', 'Gaudreau', 'Hall', 'Domi', 'Chabot', 'Dumba', 'Nurse', 'Ekblad', 'Weegar',
    'Cirelli', 'Cozens', 'Byfield', 'Suzuki', 'Caufield', 'Hutson', 'Guenther', 'Wright', 'Bedard', 'Fantilli',
    'Roy', 'Gagne', 'Tremblay', 'Bergeron', 'Cote', 'Gauthier', 'Bouchard', 'Simard', 'Fortin', 'Belanger',
    'Lemieux', 'Fleury', 'Giroux', 'Perreault', 'Beauvillier', 'Drouin', 'Dubé', 'Pelletier', 'Levesque', 'Girard',
    'Thompson', 'Walker', 'Anderson', 'Campbell', 'Morrison', 'Hughes', 'Parsons', 'Whitfield', 'Blackwood', 'Holloway',
    'MacDonald', 'Kelly', 'Murphy', 'Bennett', 'Carrick', 'Doughty', 'Hamilton', 'Provorov', 'Sillinger', 'Newhook',
  ],
}

const USA: NamePool = {
  first: [
    'Jack', 'Auston', 'Matthew', 'Brady', 'Jake', 'Cole', 'Trevor', 'Quinn', 'Luke', 'Alex',
    'Zach', 'Charlie', 'Adam', 'Kyle', 'Chris', 'Matt', 'Nick', 'Sean', 'Tyler', 'Jason',
    'Brandon', 'Kevin', 'Derek', 'Justin', 'Eric', 'Brian', 'Patrick', 'Michael', 'David', 'Ryan',
    'Casey', 'Trent', 'Tage', 'Jackson', 'Mason', 'Logan', 'Cutter', 'Rutger', 'Isaac', 'Drew',
    'Colby', 'Blake', 'Chase', 'Dawson', 'Hunter', 'Cade', 'Bryce', 'Colin', 'Dalton', 'Garrett',
    'Grant', 'Hayes', 'Jared', 'Keith', 'Landon', 'Marcus', 'Nolan', 'Oliver', 'Parker', 'Reese',
    'Shane', 'Tanner', 'Vince', 'Wyatt', 'Xander', 'Zane', 'Beau', 'Cooper', 'Dean', 'Emmett',
    'Finn', 'Gavin', 'Holden', 'Ian', 'Jonah', 'Knox', 'Leo', 'Micah', 'Nash', 'Owen',
  ],
  last: [
    'Eichel', 'Matthews', 'Tkachuk', 'Hughes', 'Werenski', 'Fox', 'Kane', 'Larkin', 'Boldy', 'Farabee',
    'Trocheck', 'Konecny', 'Gaudreau', 'Zegras', 'Turcotte', 'Caufield', 'Bjork', 'Bratt', 'Coleman', 'Compher',
    'Miller', 'Carlson', 'Faber', 'Seider', 'Buium', 'Snuggerud', 'Leonard', 'Perreault', 'Gauthier', 'Smith',
    'Johnson', 'Williams', 'Brown', 'Jones', 'Davis', 'Wilson', 'Anderson', 'Taylor', 'Thomas', 'Moore',
    'Jackson', 'White', 'Harris', 'Martin', 'Thompson', 'Garcia', 'Robinson', 'Clark', 'Lewis', 'Walker',
    'Hall', 'Allen', 'Young', 'King', 'Wright', 'Scott', 'Green', 'Baker', 'Adams', 'Nelson',
    'Carter', 'Mitchell', 'Roberts', 'Turner', 'Phillips', 'Parker', 'Evans', 'Edwards', 'Collins', 'Stewart',
    'Morris', 'Rogers', 'Reed', 'Cook', 'Bell', 'Bailey', 'Cooper', 'Richardson', 'Cox', 'Howard',
  ],
}

const SWE: NamePool = {
  first: [
    'Erik', 'William', 'Filip', 'Elias', 'Rasmus', 'Victor', 'Gabriel', 'Adrian', 'Lucas', 'Isak',
    'Anton', 'Oskar', 'Emil', 'Gustav', 'Ludvig', 'Hampus', 'Marcus', 'Mika', 'Jonas', 'Henrik',
    'Nils', 'Axel', 'Leo', 'Alfred', 'Melker', 'Noah', 'Theodor', 'Arvid', 'Simon', 'Linus',
    'Viktor', 'Jesper', 'Fabian', 'Calle', 'Pontus', 'Joel', 'David', 'Adam', 'Casper', 'Wilmer',
    'Malte', 'Sixten', 'Hugo', 'Vincent', 'Loui', 'Rickard', 'Carl', 'Johan', 'Patric', 'Mattias',
    'Andre', 'Pierre', 'Dennis', 'Fredrik', 'Jacob', 'Magnus', 'Niklas', 'Petter', 'Rasmus', 'Sebastian',
    'Tobias', 'Viggo', 'Albin', 'Benjamin', 'Colin', 'Edvin', 'Frans', 'Gustaf', 'Harald', 'Ivar',
    'Kevin', 'Liam', 'Milton', 'Nikolai', 'Olle', 'Ture', 'Uno', 'Valter', 'Wilhelm', 'Elton',
  ],
  last: [
    'Karlsson', 'Andersson', 'Nylander', 'Pettersson', 'Lindholm', 'Hedman', 'Forsberg', 'Ekman', 'Dahlin', 'Zibanejad',
    'Rakell', 'Landeskog', 'Wennberg', 'Nyquist', 'Larsson', 'Johansson', 'Bjorkstrand', 'Sundqvist', 'Sedin', 'Backlund',
    'Holmberg', 'Fransson', 'Lundqvist', 'Bergqvist', 'Sandin', 'Brodin', 'Klingberg', 'Ristolainen', 'Palmberg', 'Ohgren',
    'Nilsson', 'Eriksson', 'Larsen', 'Olsson', 'Persson', 'Svensson', 'Gustafsson', 'Jonsson', 'Bergstrom', 'Lindqvist',
    'Berg', 'Holm', 'Lund', 'Sandberg', 'Falk', 'Dahl', 'Blom', 'Ek', 'Sjoberg', 'Wallin',
    'Hansson', 'Fredriksson', 'Nordstrom', 'Sundberg', 'Wikstrom', 'Lindgren', 'Bergman', 'Hallberg', 'Engstrom', 'Palm',
    'Ahlberg', 'Blomkvist', 'Cederholm', 'Dahlberg', 'Ekstrand', 'Forslund', 'Grahn', 'Hedberg', 'Isaksson', 'Jakobsson',
    'Kallstrom', 'Lofgren', 'Magnusson', 'Nordin', 'Ostberg', 'Ronnberg', 'Stenberg', 'Tornqvist', 'Vahlberg', 'Wester',
  ],
}

const FIN: NamePool = {
  first: [
    'Aleksander', 'Mikko', 'Sebastian', 'Patrik', 'Roope', 'Kaapo', 'Miro', 'Juuso', 'Anton', 'Eeli',
    'Joel', 'Rasmus', 'Urho', 'Aatu', 'Kasper', 'Topi', 'Ville', 'Niko', 'Teemu', 'Jesse',
    'Olli', 'Henri', 'Aleksi', 'Otto', 'Elias', 'Emil', 'Leo', 'Onni', 'Eino', 'Väinö',
    'Joonas', 'Lauri', 'Markus', 'Antti', 'Tuomas', 'Sami', 'Pekka', 'Jari', 'Janne', 'Mika',
    'Petri', 'Tero', 'Ville', 'Kalle', 'Matias', 'Daniel', 'Oskari', 'Verneri', 'Arttu', 'Konsta',
    'Eemil', 'Iisakki', 'Juho', 'Kristian', 'Lenni', 'Miika', 'Niilo', 'Oiva', 'Paavo', 'Roni',
    'Saku', 'Toivo', 'Unto', 'Valtteri', 'Waltteri', 'Yrjo', 'Aapo', 'Benjamin', 'Casimir', 'Eetu',
    'Frans', 'Hugo', 'Ilmari', 'Jaakko', 'Kimi', 'Luukas', 'Miro', 'Noel', 'Otso', 'Pyry',
  ],
  last: [
    'Barkov', 'Rantanen', 'Aho', 'Laine', 'Heiskanen', 'Kakko', 'Kotkaniemi', 'Vatanen', 'Manninen', 'Lundell',
    'Luostarinen', 'Kaprizov', 'Pesce', 'Raanta', 'Saros', 'Rasanen', 'Nurmi', 'Ojala', 'Pulkkinen', 'Merela',
    'Virtanen', 'Korhonen', 'Makinen', 'Nieminen', 'Makela', 'Hamalainen', 'Laine', 'Heikkinen', 'Koskinen', 'Jarvinen',
    'Lehtonen', 'Saarinen', 'Salminen', 'Heinonen', 'Niemi', 'Heikkila', 'Kinnunen', 'Salonen', 'Turunen', 'Laakso',
    'Rantala', 'Lahtinen', 'Ahonen', 'Mustonen', 'Halonen', 'Elo', 'Rasanen', 'Aalto', 'Manninen', 'Suominen',
    'Hakala', 'Kallio', 'Leppanen', 'Ojanen', 'Peltola', 'Rautio', 'Sipila', 'Toivonen', 'Vainio', 'Ylonen',
    'Anttila', 'Eskola', 'Haapala', 'Immonen', 'Jokinen', 'Karjalainen', 'Lampinen', 'Miettinen', 'Nurminen', 'Ollila',
    'Partanen', 'Ranta', 'Savolainen', 'Tuominen', 'Uusitalo', 'Valkama', 'Wirtanen', 'Yli', 'Ikonen', 'Junttila',
  ],
}

const RUS: NamePool = {
  first: [
    'Nikita', 'Andrei', 'Kirill', 'Artemi', 'Vladimir', 'Evgeni', 'Dmitri', 'Alexander', 'Ivan', 'Maxim',
    'Sergei', 'Pavel', 'Mikhail', 'Anton', 'Yakov', 'Yegor', 'Matvei', 'Danila', 'Arseni', 'Roman',
    'Vasili', 'Nikolai', 'Amir', 'Fyodor', 'Gleb', 'Timofei', 'Semyon', 'Ilya', 'Grigori', 'Denis',
    'Alexei', 'Boris', 'Vadim', 'Vitali', 'Valeri', 'Oleg', 'Igor', 'Konstantin', 'Leonid', 'Georgi',
    'Rodion', 'Yuri', 'Stepan', 'Makar', 'Miron', 'Savva', 'Timur', 'Bogdan', 'Daniil', 'German',
    'Klim', 'Lev', 'Mark', 'Platon', 'Ruslan', 'Svyatoslav', 'Trofim', 'Yaroslav', 'Zakhar', 'Arkadi',
    'Prokhor', 'Rostislav', 'Vsevolod', 'Vladislav', 'Efim', 'Filipp', 'Damir', 'Innokenti', 'Kuzma', 'Artur',
    'Miroslav', 'Nazar', 'Vyacheslav', 'Radomir', 'Stanislav', 'Rustam', 'Marat', 'Rinat', 'Bulat', 'Renat',
  ],
  last: [
    'Kucherov', 'Malkin', 'Ovechkin', 'Panarin', 'Vasilevskiy', 'Sorokin', 'Kaprizov', 'Tarasenko', 'Kuznetsov', 'Buchnevich',
    'Provorov', 'Gusev', 'Sergachev', 'Zadorov', 'Orlov', 'Nichushkin', 'Svechnikov', 'Michkov', 'Miroshnichenko', 'Yurov',
    'Bobrovsky', 'Shesterkin', 'Fedotov', 'Askarov', 'Chinakhov', 'Marchenko', 'Voronkov', 'Gushchin', 'Simashev', 'Ivanov',
    'Petrov', 'Sidorov', 'Smirnov', 'Kuznetsov', 'Popov', 'Sokolov', 'Lebedev', 'Kozlov', 'Novikov', 'Morozov',
    'Volkov', 'Alekseev', 'Lukin', 'Belov', 'Komarov', 'Orlov', 'Kiselev', 'Makarov', 'Andreev', 'Nikitin',
    'Zaitsev', 'Solovyov', 'Borisov', 'Yakovlev', 'Grigoriev', 'Romanov', 'Vorobyov', 'Sergeev', 'Kuzmin', 'Frolov',
    'Bykov', 'Denisov', 'Gerasimov', 'Efimov', 'Filatov', 'Golubev', 'Isaev', 'Kalinin', 'Loginov', 'Maslov',
    'Nazarov', 'Osipov', 'Panov', 'Rybakov', 'Savin', 'Titov', 'Ustinov', 'Vlasov', 'Yudin', 'Zhukov',
  ],
}

const CZE: NamePool = {
  first: [
    'David', 'Jakub', 'Martin', 'Tomas', 'Ondrej', 'Filip', 'Jan', 'Lukas', 'Radek', 'Petr',
    'Pavel', 'Jaromir', 'Dominik', 'Roman', 'Michal', 'Vojtech', 'Adam', 'Matej', 'Daniel', 'Marek',
    'Vaclav', 'Jiri', 'Josef', 'Karel', 'Milan', 'Zdenek', 'Radim', 'Stanislav', 'Vladimir', 'Ales',
    'Antonin', 'Bohumil', 'Ctirad', 'Dalibor', 'Emil', 'Frantisek', 'Gustav', 'Havel', 'Ivan', 'Jindrich',
    'Kamil', 'Ladislav', 'Miloslav', 'Nikola', 'Oldrich', 'Patrik', 'Radovan', 'Svatopluk', 'Tobias', 'Vit',
    'Zbynek', 'Bedrich', 'Cenek', 'Drahomir', 'Evzen', 'Ferdinand', 'Gabriel', 'Hynek', 'Igor', 'Jaroslav',
    'Krystof', 'Libor', 'Mikulas', 'Norbert', 'Otakar', 'Premysl', 'Rostislav', 'Sebastian', 'Teodor', 'Vratislav',
    'Alois', 'Blahoslav', 'Ctibor', 'Dusan', 'Eduard', 'Florian', 'Bohuslav', 'Hubert', 'Ivo', 'Jonas',
  ],
  last: [
    'Pastrnak', 'Palat', 'Hertl', 'Necas', 'Vrana', 'Kubalik', 'Zacha', 'Chytil', 'Faksa', 'Hronek',
    'Vlasic', 'Rutta', 'Sedlak', 'Kampf', 'Blumel', 'Dostal', 'Vejmelka', 'Mrazek', 'Nosek', 'Simek',
    'Novak', 'Svoboda', 'Novotny', 'Dvorak', 'Cerny', 'Prochazka', 'Kucera', 'Vesely', 'Horak', 'Nemec',
    'Pokorny', 'Marek', 'Pospisil', 'Hajek', 'Jelinek', 'Kral', 'Ruzicka', 'Fiala', 'Sykora', 'Benes',
    'Konecny', 'Malik', 'Urban', 'Kolar', 'Kriz', 'Sima', 'Bartos', 'Blazek', 'Cermak', 'Dolezal',
    'Fiser', 'Havlik', 'Jandera', 'Kadlec', 'Liska', 'Machacek', 'Nedved', 'Ondracek', 'Pavlik', 'Riha',
    'Slavik', 'Tesar', 'Vanek', 'Zeman', 'Beran', 'Cihak', 'Duda', 'Foltyn', 'Hora', 'Janda',
    'Kalina', 'Lang', 'Masek', 'Nyklicek', 'Otava', 'Panek', 'Rada', 'Simon', 'Turek', 'Valenta',
  ],
}

const POOLS: Record<string, NamePool> = { CAN, USA, SWE, FIN, RUS, CZE }

// Weighted distribution of nationalities for generated prospects (NHL-ish mix).
const NATION_WEIGHTS: { nation: string; w: number }[] = [
  { nation: 'CAN', w: 40 },
  { nation: 'USA', w: 26 },
  { nation: 'SWE', w: 12 },
  { nation: 'FIN', w: 8 },
  { nation: 'RUS', w: 9 },
  { nation: 'CZE', w: 5 },
]
const NATION_TOTAL = NATION_WEIGHTS.reduce((s, n) => s + n.w, 0)

export function pickNationality(rng: Rng): string {
  let r = rng.float(0, NATION_TOTAL)
  for (const n of NATION_WEIGHTS) {
    if (r < n.w) return n.nation
    r -= n.w
  }
  return 'CAN'
}

/** Generate a full name for a given nationality (falls back to CAN pool). */
export function generateName(rng: Rng, nationality: string): string {
  const pool = POOLS[nationality] ?? CAN
  return `${rng.pick(pool.first)} ${rng.pick(pool.last)}`
}
