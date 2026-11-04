// ================= VARIÁVEIS GLOBAIS E DOM =================
// Aproveita a lista salva com o nome antigo do projeto (Javi-Vover), se existir
let savedItems = JSON.parse(localStorage.getItem('roteirodebolso_lista') || localStorage.getItem('javivover_lista')) || [];
let currentApiItem = null;

const formBusca = document.getElementById('form-busca');
const inputBuscaTitulo = document.getElementById('busca-titulo');
const selectBuscaTipo = document.getElementById('busca-tipo');
const divResultados = document.getElementById('resultados-busca');
const divListaSalva = document.getElementById('lista-salva');
const msgVazio = document.getElementById('msg-vazio');

const divSugestao = document.getElementById('sugestao-ortografica');
const termoSugerido = document.getElementById('termo-sugerido');

// Filtros
const formFiltros = document.getElementById('form-filtros');
const filtroTipo = document.getElementById('filtro-tipo');
const filtroGenero = document.getElementById('filtro-genero');
const filtroAno = document.getElementById('filtro-ano');

// Modal Elements
const modal = document.getElementById('modal-item');
const btnFecharModal = document.getElementById('fechar-modal');
const formSalvar = document.getElementById('form-salvar');
const btnDeletarModal = document.getElementById('btn-deletar-modal');

let debounceTimer;

// Imagem de "sem capa" embutida (o via.placeholder.com saiu do ar)
const SEM_CAPA = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450"><rect width="100%" height="100%" fill="#1f2029"/><text x="50%" y="50%" fill="#888" font-size="22" text-anchor="middle" font-family="sans-serif">Sem Capa</text></svg>'
);

// Evita que textos vindos da API quebrem o HTML
function esc(t) {
    return String(t ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ================= TMDB (FILMES) =================
const TMDB_KEY = 'a0323e03ef1ebc5acf8f44bf5c60db8e';
const TMDB_IMG = 'https://image.tmdb.org/t/p/w500';
let generosTMDB = null; // cache: { id: nome }

async function carregarGenerosTMDB() {
    if (generosTMDB) return generosTMDB;
    const res = await fetch(`https://api.themoviedb.org/3/genre/movie/list?api_key=${TMDB_KEY}&language=pt-BR`);
    if (!res.ok) throw new Error('TMDB respondeu HTTP ' + res.status + ' (verifique a chave)');
    const data = await res.json();
    generosTMDB = {};
    data.genres.forEach(g => generosTMDB[g.id] = g.name);
    return generosTMDB;
}

async function buscarFilmesTMDB(query) {
    const generos = await carregarGenerosTMDB();
    const url = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_KEY}&language=pt-BR&include_adult=false&query=${encodeURIComponent(query)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('TMDB respondeu HTTP ' + res.status);
    const data = await res.json();
    return (data.results || []).map(f => ({
        id: 'tmdb_' + f.id,
        tipo: 'filme',
        titulo: f.title || 'Sem Título',
        imagem: f.poster_path ? TMDB_IMG + f.poster_path : SEM_CAPA,
        genero: f.genre_ids && f.genre_ids.length ? (generos[f.genre_ids[0]] || 'Desconhecido') : 'Desconhecido',
        ano: f.release_date ? f.release_date.substring(0, 4) : 'N/D',
        sinopse: f.overview || 'Sem sinopse.',
        trailer: null
    }));
}

// ================= INICIALIZAÇÃO =================
document.addEventListener('DOMContentLoaded', () => {
    atualizarFiltroGeneros();
    renderSavedItems();
});

// ================= SUGESTÃO ORTOGRÁFICA (Apenas Correção) =================
async function buscarSugestaoOrtografica(termo) {
    if (termo.length < 3) {
        divSugestao.classList.add('hidden');
        return;
    }
    try {
        const res = await fetch(`https://api.datamuse.com/sug?s=${encodeURIComponent(termo)}`);
        const data = await res.json();
        
        if (data.length > 0 && data[0].word.toLowerCase() !== termo.toLowerCase()) {
            termoSugerido.textContent = data[0].word;
            divSugestao.classList.remove('hidden');
        } else {
            divSugestao.classList.add('hidden');
        }
    } catch (error) {
        divSugestao.classList.add('hidden');
    }
}

// O evento 'input' serve APENAS para sugerir a correção. NÃO faz busca de filmes.
inputBuscaTitulo.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        buscarSugestaoOrtografica(inputBuscaTitulo.value.trim());
    }, 400);
});

// ================= CONSUMO DE API (BUSCA MANUAL) =================

// Clicar na sugestão
termoSugerido.addEventListener('click', () => {
    inputBuscaTitulo.value = termoSugerido.textContent;
    divSugestao.classList.add('hidden');
    realizarBusca(); 
});

// Clicar no botão Buscar ou dar Enter
formBusca.addEventListener('submit', (e) => {
    e.preventDefault();
    divSugestao.classList.add('hidden');
    realizarBusca();
});

// ================= TRAILER (TMDB -> YouTube) =================
const cacheTrailers = {}; // evita repetir requisições

async function buscarVideoTMDB(idNumerico, idioma) {
    const url = `https://api.themoviedb.org/3/movie/${idNumerico}/videos?api_key=${TMDB_KEY}&language=${idioma}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const videos = (data.results || []).filter(v => v.site === 'YouTube');
    // prefere trailer oficial, depois qualquer trailer, depois teaser
    return videos.find(v => v.type === 'Trailer' && v.official)
        || videos.find(v => v.type === 'Trailer')
        || videos.find(v => v.type === 'Teaser')
        || null;
}

async function obterLinkTrailer(item) {
    const idNum = String(item.id).replace('tmdb_', '');
    if (cacheTrailers[idNum] !== undefined) return cacheTrailers[idNum];
    let link = null;
    try {
        const video = (await buscarVideoTMDB(idNum, 'pt-BR')) || (await buscarVideoTMDB(idNum, 'en-US'));
        if (video) link = `https://www.youtube.com/watch?v=${video.key}`;
    } catch (e) { console.warn('Erro ao buscar trailer:', e); }
    // se o TMDB não tiver trailer, abre uma busca no YouTube
    if (!link) link = `https://www.youtube.com/results?search_query=${encodeURIComponent(item.titulo + ' ' + item.ano + ' trailer')}`;
    cacheTrailers[idNum] = link;
    return link;
}

async function configurarBotaoTrailer(item) {
    const btn = document.getElementById('btn-trailer');
    btn.classList.add('hidden');
    if (item.tipo !== 'filme' || !String(item.id).startsWith('tmdb_')) return;
    const link = await obterLinkTrailer(item);
    if (currentApiItem === item) { // só mostra se o modal ainda for deste filme
        btn.href = link;
        btn.classList.remove('hidden');
    }
}

// ================= LINKS DE COMPRA (LIVROS) =================
// Nenhuma dessas lojas tem API pública gratuita para achar o produto exato,
// então montamos o link da BUSCA da loja com o título (e o autor) do livro.
function slugMercadoLivre(texto) {
    return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function configurarLinksLivro(item) {
    const box = document.getElementById('links-livro');
    if (item.tipo !== 'livro') { box.classList.add('hidden'); return; }

    const titulo = item.titulo;
    const tituloAutor = item.autor ? `${item.titulo} ${item.autor}` : item.titulo;

    document.getElementById('btn-estante').href =
        `https://www.estantevirtual.com.br/busca?q=${encodeURIComponent(titulo)}`;
    document.getElementById('btn-amazon').href =
        `https://www.amazon.com.br/s?k=${encodeURIComponent(tituloAutor)}&i=stripbooks`;
    document.getElementById('btn-ml').href =
        `https://lista.mercadolivre.com.br/${slugMercadoLivre('livro ' + tituloAutor)}`;
    box.classList.remove('hidden');
}

// ================= LIVROS: OPEN LIBRARY (principal) + GOOGLE BOOKS (reserva) =================
async function buscarLivrosOpenLibrary(query) {
    const campos = 'key,title,author_name,first_publish_year,cover_i,subject,first_sentence';
    const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=30&fields=${campos}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Open Library respondeu HTTP ' + res.status);
    const data = await res.json();
    return (data.docs || []).map(l => {
        const frase = Array.isArray(l.first_sentence) ? l.first_sentence[0] : (l.first_sentence || '');
        return {
            id: 'ol_' + l.key.replace('/works/', ''),
            tipo: 'livro',
            titulo: l.title || 'Sem Título',
            imagem: l.cover_i ? `https://covers.openlibrary.org/b/id/${l.cover_i}-M.jpg` : SEM_CAPA,
            genero: l.subject && l.subject.length ? l.subject[0] : 'Desconhecido',
            autor: l.author_name && l.author_name.length ? l.author_name[0] : '',
            ano: l.first_publish_year ? String(l.first_publish_year) : 'N/D',
            sinopse: frase || '',
            workKey: l.key,
            trailer: null
        };
    });
}

async function buscarLivrosGoogle(query) {
    const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=30`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Google Books respondeu HTTP ' + res.status);
    const data = await res.json();
    return (data.items || []).map(item => ({
        id: item.id,
        tipo: 'livro',
        titulo: item.volumeInfo.title || 'Sem Título',
        imagem: item.volumeInfo.imageLinks && item.volumeInfo.imageLinks.thumbnail ? item.volumeInfo.imageLinks.thumbnail.replace('http:', 'https:') : SEM_CAPA,
        genero: item.volumeInfo.categories ? item.volumeInfo.categories[0] : 'Desconhecido',
        autor: item.volumeInfo.authors && item.volumeInfo.authors.length ? item.volumeInfo.authors[0] : '',
        ano: item.volumeInfo.publishedDate ? item.volumeInfo.publishedDate.substring(0, 4) : 'N/D',
        sinopse: item.volumeInfo.description || 'Sem sinopse.',
        trailer: null
    }));
}

async function buscarLivros(query) {
    try {
        const r = await buscarLivrosOpenLibrary(query);
        if (r.length) return r;
    } catch (erro) {
        console.warn('Open Library falhou, tentando Google Books:', erro);
    }
    return buscarLivrosGoogle(query);
}

// Sinopse completa do livro (Open Library), buscada ao abrir o modal
async function carregarSinopseLivro(item) {
    if (!item.workKey || item.sinopse) return;
    try {
        const res = await fetch(`https://openlibrary.org${item.workKey}.json`);
        if (!res.ok) return;
        const w = await res.json();
        const desc = typeof w.description === 'string' ? w.description : (w.description && w.description.value) || '';
        item.sinopse = desc || 'Sem sinopse.';
    } catch (e) { item.sinopse = 'Sem sinopse.'; }
    if (currentApiItem === item) document.getElementById('modal-sinopse').textContent = item.sinopse;
}

async function realizarBusca() {
    const query = inputBuscaTitulo.value.trim();
    const tipo = selectBuscaTipo.value;
    
    if (query.length < 3) return;

    divResultados.innerHTML = '<p class="msg-empty">⏳ A procurar na base de dados...</p>';
    divResultados.classList.remove('hidden');

    try {
        let resultados = [];
        
        if (tipo === 'filme') {
            resultados = await buscarFilmesTMDB(query);
        } else {
            resultados = await buscarLivros(query);
        }

        renderResultadosBusca(resultados);
        
    } catch (error) {
        console.error('Erro na busca:', error);
        divResultados.innerHTML = `<p class="msg-empty" style="color: var(--danger);">Erro: Não foi possível ligar à base de dados (${esc(error.message)}). Tente novamente mais tarde.</p>`;
    }
}

// ================= RENDERIZAÇÃO DOM (BUSCA) =================
function renderResultadosBusca(resultados) {
    divResultados.innerHTML = '';
    
    if(!resultados || resultados.length === 0) {
        divResultados.innerHTML = '<p class="msg-empty">Nenhum resultado encontrado. Tente outro termo.</p>';
        return;
    }

    resultados.forEach(item => {
        const card = document.createElement('div');
        card.classList.add('card');
        card.innerHTML = `
            <img src="${esc(item.imagem)}" alt="Capa de ${esc(item.titulo)}">
            <div class="card-body">
                <h3 class="card-title">${esc(item.titulo)}</h3>
                <div>
                    <span class="badge">${esc(item.ano)}</span>
                    <span class="badge">${esc(item.genero)}</span>
                </div>
            </div>
        `;
        card.addEventListener('click', () => abrirModal(item, false));
        divResultados.appendChild(card);
    });
}

// ================= CRUD (CRIAR, LER, ATUALIZAR, APAGAR) =================
function abrirModal(itemData, isEditMode = false) {
    currentApiItem = itemData;
    
    document.getElementById('modal-titulo').textContent = itemData.titulo;
    document.getElementById('modal-img').src = itemData.imagem;
    document.getElementById('modal-genero').textContent = itemData.genero;
    document.getElementById('modal-ano').textContent = itemData.ano;
    document.getElementById('modal-sinopse').textContent = itemData.sinopse || 'Carregando sinopse...';
    carregarSinopseLivro(itemData);
    configurarBotaoTrailer(itemData);
    configurarLinksLivro(itemData);
    document.getElementById('btn-criar-sala').textContent = itemData.tipo === 'filme' ? '🎟 Criar sala de cinema' : '📖 Criar clube de leitura';

    const trailerContainer = document.getElementById('trailer-container');
    const trailerVideo = document.getElementById('modal-trailer');
    if (itemData.trailer) {
        trailerVideo.src = itemData.trailer;
        trailerContainer.classList.remove('hidden');
    } else {
        trailerVideo.src = "";
        trailerContainer.classList.add('hidden');
    }

    document.getElementById('item-id').value = isEditMode ? itemData.id : '';
    document.getElementById('item-status').value = isEditMode ? itemData.status : 'Quero ver/ler';
    document.getElementById('item-comentario').value = isEditMode ? itemData.comentario : '';
    
    const btnSalvar = document.getElementById('btn-salvar-modal');
    
    if(isEditMode) {
        btnDeletarModal.classList.remove('hidden');
        btnSalvar.textContent = 'Salvar Alterações';
    } else {
        btnDeletarModal.classList.add('hidden');
        btnSalvar.textContent = 'Salvar na minha lista';
    }

    modal.classList.remove('hidden');
}

formSalvar.addEventListener('submit', (e) => {
    e.preventDefault();
    
    const id = document.getElementById('item-id').value;
    const status = document.getElementById('item-status').value;
    const comentario = document.getElementById('item-comentario').value;

    if (id) {
        const index = savedItems.findIndex(i => i.id === id);
        if(index !== -1) {
            savedItems[index].status = status;
            savedItems[index].comentario = comentario;
        }
    } else {
        if(savedItems.find(i => i.id === currentApiItem.id)) {
            alert('Este título já está guardado na sua lista!');
            return;
        }
        const novoItem = { ...currentApiItem, status: status, comentario: comentario };
        savedItems.push(novoItem);
    }

    salvarNoLocalStorage();
    fecharModal();
});

btnDeletarModal.addEventListener('click', () => {
    const id = document.getElementById('item-id').value;
    if(confirm('Tem a certeza de que pretende eliminar este item da sua lista?')) {
        savedItems = savedItems.filter(item => item.id !== id);
        salvarNoLocalStorage();
        fecharModal();
    }
});

function renderSavedItems() {
    divListaSalva.innerHTML = '';
    const tipo = filtroTipo.value;
    const genero = filtroGenero.value;
    const ano = filtroAno.value;

    const filtrados = savedItems.filter(item => {
        const matchTipo = tipo === '' || item.tipo === tipo;
        const matchGenero = genero === '' || item.genero === genero;
        const matchAno = ano === '' || item.ano === ano;
        return matchTipo && matchGenero && matchAno;
    });

    if(filtrados.length === 0) {
        msgVazio.classList.remove('hidden');
    } else {
        msgVazio.classList.add('hidden');
        filtrados.forEach(item => {
            const card = document.createElement('div');
            card.classList.add('card');
            const iconeTipo = item.tipo === 'filme' ? '🎬' : '📖';

            card.innerHTML = `
                <img src="${esc(item.imagem)}" alt="Capa de ${esc(item.titulo)}">
                <div class="card-body">
                    <h3 class="card-title">${esc(item.titulo)}</h3>
                    <div>
                        <span class="badge">${iconeTipo} ${item.tipo.toUpperCase()}</span>
                        <span class="badge">${esc(item.ano)}</span>
                    </div>
                    <span class="badge status-badge">${esc(item.status)}</span>
                </div>
            `;
            card.addEventListener('click', () => abrirModal(item, true));
            divListaSalva.appendChild(card);
        });
    }
}

function atualizarFiltroGeneros() {
    const generosUnicos = savedItems.reduce((acc, item) => {
        if (!acc.includes(item.genero)) acc.push(item.genero);
        return acc;
    }, []);
    
    filtroGenero.innerHTML = '<option value="">Todos os géneros</option>';
    generosUnicos.forEach(g => {
        const opt = document.createElement('option');
        opt.value = g;
        opt.textContent = g;
        filtroGenero.appendChild(opt);
    });
}

[filtroTipo, filtroGenero, filtroAno].forEach(input => {
    input.addEventListener('change', renderSavedItems);
    input.addEventListener('keyup', renderSavedItems);
});

function salvarNoLocalStorage() {
    localStorage.setItem('roteirodebolso_lista', JSON.stringify(savedItems));
    atualizarFiltroGeneros();
    renderSavedItems();
    divResultados.innerHTML = '';
    divResultados.classList.add('hidden');
    document.getElementById('busca-titulo').value = '';
}

function fecharModal() {
    modal.classList.add('hidden');
    const trailerVideo = document.getElementById('modal-trailer');
    if (!trailerVideo.paused) {
        trailerVideo.pause();
    }
}

btnFecharModal.addEventListener('click', fecharModal);
window.addEventListener('click', (e) => {
    if (e.target === modal) fecharModal();
});

// ================= SALAS DE CINEMA / CLUBE DE LEITURA (Firebase) =================
// 1) Crie um projeto em console.firebase.google.com, ative o "Realtime Database"
// 2) Cole abaixo a configuração do seu app web (todos os amigos usam a mesma)
const FIREBASE_CONFIG = {
    apiKey: '',
    authDomain: '',
    databaseURL: '',   // ex.: https://SEU-PROJETO-default-rtdb.firebaseio.com
    projectId: '',
    appId: ''
};

let db = null;
try {
    if (FIREBASE_CONFIG.databaseURL && window.firebase) {
        firebase.initializeApp(FIREBASE_CONFIG);
        db = firebase.database();
    }
} catch (e) { console.error('Firebase:', e); }

// identidade simples (sem login): id aleatório + apelido guardados neste navegador
const meuId = localStorage.getItem('rb_uid') || (() => {
    const id = 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    localStorage.setItem('rb_uid', id);
    return id;
})();
let refMsgs = null;
let salaAberta = null;
const $id = id => document.getElementById(id);

function abrirNovaSala() {
    if (!db) { alert('As salas ainda não estão configuradas: cole a configuração do Firebase no script.js.'); return; }
    const filme = currentApiItem.tipo === 'filme';
    $id('nova-sala-titulo').textContent = (filme ? '🎟 Sala de cinema: ' : '📖 Clube de leitura: ') + currentApiItem.titulo;
    $id('sala-apelido').value = localStorage.getItem('rb_apelido') || '';
    $id('modal-nova-sala').classList.remove('hidden');
}

$id('btn-criar-sala').addEventListener('click', abrirNovaSala);
$id('fechar-nova-sala').addEventListener('click', () => $id('modal-nova-sala').classList.add('hidden'));

$id('form-nova-sala').addEventListener('submit', async e => {
    e.preventDefault();
    const apelido = $id('sala-apelido').value.trim();
    localStorage.setItem('rb_apelido', apelido);
    const novaRef = db.ref('salas').push();
    await novaRef.set({
        tipo: currentApiItem.tipo,
        titulo: currentApiItem.titulo,
        imagem: currentApiItem.imagem,
        ano: currentApiItem.ano,
        quando: $id('sala-data').value,
        local: $id('sala-local').value.trim(),
        criador: apelido,
        criadorId: meuId,
        participantes: { [meuId]: apelido }
    });
    $id('modal-nova-sala').classList.add('hidden');
    e.target.reset();
    fecharModal();
    mostrarVista('lista');
    abrirPainel(); // mostra a sala recém-criada no painel lateral
});

function renderSalas(salas) {
    const total = Object.keys(salas || {}).length;
    $id('badge-salas').textContent = total;
    $id('badge-salas').classList.toggle('hidden', total === 0);
    const lista = $id('lista-salas');
    lista.innerHTML = '';
    const ids = Object.keys(salas || {}).sort((a, b) => salas[a].quando.localeCompare(salas[b].quando));
    if (!ids.length) { lista.innerHTML = '<p class="msg-empty">Nenhuma sala criada ainda.</p>'; return; }
    ids.forEach(id => {
        const s = salas[id];
        const qtd = s.participantes ? Object.keys(s.participantes).length : 0;
        const quando = new Date(s.quando).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
        const card = document.createElement('div');
        card.className = 'sala-card';
        card.innerHTML = `
            <img src="${esc(s.imagem)}" alt="">
            <div class="info">
                <strong>${s.tipo === 'filme' ? '🎟' : '📖'} ${esc(s.titulo)}</strong>
                <span>📅 ${esc(quando)}</span>
                ${s.local ? `<span>📍 ${esc(s.local)}</span>` : ''}
                <span>👤 ${esc(s.criador)} • 👥 ${qtd} confirmado(s)</span>
                <div class="acoes">
                    <button data-entrar="${id}">Entrar / Chat</button>
                    ${s.criadorId === meuId ? `<button class="excluir" data-excluir="${id}">Excluir</button>` : ''}
                </div>
            </div>`;
        lista.appendChild(card);
    });
}

if (db) {
    db.ref('salas').on('value', snap => renderSalas(snap.val()));
} else {
    const aviso = $id('aviso-salas');
    aviso.textContent = 'Salas desativadas: falta colar a configuração do Firebase no script.js.';
    aviso.classList.remove('hidden');
}

$id('lista-salas').addEventListener('click', async e => {
    const entrar = e.target.dataset.entrar, excluir = e.target.dataset.excluir;
    if (excluir && confirm('Excluir esta sala e o chat?')) db.ref('salas/' + excluir).remove();
    if (!entrar) return;
    let apelido = localStorage.getItem('rb_apelido');
    if (!apelido) {
        apelido = (prompt('Qual apelido você quer usar no chat?') || '').trim().slice(0, 20);
        if (!apelido) return;
        localStorage.setItem('rb_apelido', apelido);
    }
    const snap = await db.ref('salas/' + entrar).once('value');
    const s = snap.val();
    if (!s) return;
    db.ref(`salas/${entrar}/participantes/${meuId}`).set(apelido); // confirma presença
    $id('painel-titulo').textContent = (s.tipo === 'filme' ? '🎟 ' : '📖 ') + s.titulo;
    $id('sala-info').textContent = `📅 ${new Date(s.quando).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}` + (s.local ? ` • 📍 ${s.local}` : '') + ` • Criada por ${s.criador}`;
    $id('chat-msgs').innerHTML = '';
    salaAberta = entrar;
    if (refMsgs) refMsgs.off(); // para de ouvir a sala anterior
    mostrarVista('chat');
    refMsgs = db.ref(`salas/${entrar}/mensagens`).limitToLast(100);
    refMsgs.on('child_added', m => {
        const msg = m.val(), box = $id('chat-msgs');
        const div = document.createElement('div');
        div.className = 'chat-msg' + (msg.uid === meuId ? ' minha' : '');
        const autor = document.createElement('b'); autor.textContent = msg.autor;
        div.append(autor, document.createTextNode(msg.texto)); // textContent: sem risco de HTML injetado
        box.appendChild(div);
        box.scrollTop = box.scrollHeight;
    });
});

$id('form-chat').addEventListener('submit', e => {
    e.preventDefault();
    const texto = $id('chat-texto').value.trim();
    if (!texto || !db) return;
    db.ref(`salas/${salaAberta}/mensagens`).push({
        autor: localStorage.getItem('rb_apelido') || 'Anônimo',
        uid: meuId,
        texto,
        hora: firebase.database.ServerValue.TIMESTAMP
    });
    $id('chat-texto').value = '';
});

// ---------- Painel lateral (abrir / fechar / alternar entre lista e chat) ----------
function mostrarVista(vista) {
    const chat = vista === 'chat';
    $id('vista-lista').classList.toggle('hidden', chat);
    $id('vista-chat').classList.toggle('hidden', !chat);
    $id('voltar-salas').classList.toggle('hidden', !chat);
    if (!chat) {
        if (refMsgs) { refMsgs.off(); refMsgs = null; }
        $id('painel-titulo').textContent = '🎟 Salas e Clubes';
    }
}
function abrirPainel() { $id('painel-salas').classList.add('aberto'); }
function fecharPainel() { $id('painel-salas').classList.remove('aberto'); }

$id('btn-abrir-salas').addEventListener('click', () => {
    $id('painel-salas').classList.contains('aberto') ? fecharPainel() : abrirPainel();
});
$id('fechar-painel').addEventListener('click', fecharPainel);
$id('voltar-salas').addEventListener('click', () => mostrarVista('lista'));

// ================= ABAS FILMES / LIVROS (com troca de tema) =================
const abas = document.querySelectorAll('.aba');

function trocarAba(tipo) {
    selectBuscaTipo.value = tipo;                                          // o resto do código lê este valor
    document.body.dataset.tema = tipo === 'filme' ? 'filmes' : 'livros';   // muda cor e anima o indicador
    abas.forEach(a => a.classList.toggle('ativa', a.dataset.tipo === tipo));
    inputBuscaTitulo.placeholder = tipo === 'filme'
        ? 'Digite o título do filme (Ex: Carrie, a Estranha)...'
        : 'Digite o título do livro (Ex: Harry Potter)...';
    // limpa resultados da aba anterior e, se já havia texto, busca na nova aba
    divResultados.innerHTML = '';
    divResultados.classList.add('hidden');
    divSugestao.classList.add('hidden');
    if (inputBuscaTitulo.value.trim().length >= 3) realizarBusca();
}
abas.forEach(a => a.addEventListener('click', () => trocarAba(a.dataset.tipo)));
